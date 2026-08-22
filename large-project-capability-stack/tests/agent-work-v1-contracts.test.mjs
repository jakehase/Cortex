import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AGENT_WORK_V1_SCHEMA_FILES,
  compileCanonicalAgentWork,
  loadAgentWorkV1Schemas,
  upgradeAgentWorkV0ToV1,
  validateAgentWorkV1Bundle,
  validateAgentWorkV1Contract,
  validateAuthorityMatrix,
  validateCanonicalEntrypoints
} from '../packages/canonical-agent-work/index.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'fixtures/agent-work-v1', name), 'utf8'));
const readJson = (target) => JSON.parse(fs.readFileSync(target, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

const validContracts = fixture('valid-contracts.json');

test('Agent Work v1 catalog exposes twelve unique checked-in schemas', () => {
  const schemas = loadAgentWorkV1Schemas();
  assert.equal(Object.keys(schemas).length, 12);
  assert.deepEqual(Object.keys(schemas).sort(), Object.keys(AGENT_WORK_V1_SCHEMA_FILES).sort());
  assert.equal(new Set(Object.values(schemas).map((schema) => schema.$id)).size, 12);
  for (const file of Object.values(AGENT_WORK_V1_SCHEMA_FILES)) {
    assert.equal(fs.existsSync(path.join(root, 'packages/canonical-agent-work/schemas', file)), true, file);
  }
});

test('every v1 schema accepts its valid golden contract', () => {
  for (const [kind, value] of Object.entries(validContracts)) {
    const validation = validateAgentWorkV1Contract(kind, value);
    assert.equal(validation.ok, true, `${kind}: ${JSON.stringify(validation.errors)}`);
  }
});

test('every v1 schema rejects unknown top-level critical fields', () => {
  for (const [kind, value] of Object.entries(validContracts)) {
    const invalid = { ...clone(value), unknownCriticalField: true };
    const validation = validateAgentWorkV1Contract(kind, invalid);
    assert.equal(validation.ok, false, kind);
    assert.equal(validation.errors.some((error) => error.code === 'additionalProperties'), true, kind);
  }
});

test('v1 validation rejects malformed safety and identity fields', () => {
  const objective = clone(validContracts.objectiveContract);
  delete objective.anchor;
  assert.equal(validateAgentWorkV1Contract('objectiveContract', objective).errors.some((error) => error.code === 'required'), true);

  const lease = clone(validContracts.lease);
  lease.fencingToken = 0;
  assert.equal(validateAgentWorkV1Contract('lease', lease).errors.some((error) => error.code === 'minimum'), true);

  const verifier = clone(validContracts.verifierResult);
  verifier.independent = false;
  assert.equal(validateAgentWorkV1Contract('verifierResult', verifier).errors.some((error) => error.code === 'const'), true);

  const completion = clone(validContracts.completionPacket);
  completion.sourceDigest = 'not-a-digest';
  assert.equal(validateAgentWorkV1Contract('completionPacket', completion).errors.some((error) => error.code === 'pattern'), true);
});

test('cross-contract validation enforces run/objective identity and explicit external-send permission', () => {
  const bundle = {
    objectiveContract: clone(validContracts.objectiveContract),
    permissionContract: clone(validContracts.permissionContract),
    budgetContract: clone(validContracts.budgetContract),
    runManifest: clone(validContracts.runManifest),
    taskContracts: [clone(validContracts.task)]
  };
  assert.equal(validateAgentWorkV1Bundle(bundle).ok, true);
  bundle.taskContracts[0].runId = 'different-run';
  assert.equal(validateAgentWorkV1Bundle(bundle).errors.some((error) => error.code === 'crossContract'), true);
  bundle.taskContracts[0].runId = 'fixture-run';
  bundle.permissionContract.externalWritesAllowed = true;
  assert.equal(validateAgentWorkV1Bundle(bundle).errors.some((error) => error.message.includes('external_send')), true);
  bundle.permissionContract.externalWritesAllowed = false;
  bundle.permissionContract.allow.push('external_send');
  assert.equal(validateAgentWorkV1Bundle(bundle).errors.some((error) => error.message.includes('both allowed and forbidden')), true);
});

test('v0 Cortex handoff upgrades exactly to the frozen v1 compatibility golden', () => {
  const input = fixture('v0-cortex-handoff.json');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-v1-upgrade-'));
  const compiled = compileCanonicalAgentWork({ input, outputDir: out, options: { runId: 'agent-work-v1-golden' } });
  const { validation, ...actual } = compiled.v1Contracts;
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.deepEqual(actual, fixture('v1-compatibility-golden.json'));
  assert.equal(actual.permissionContract.externalWritesAllowed, false);
  assert.equal(actual.runManifest.planDigest, '8f7f25962c1ff4ef1909bd0b35dcbf04004541e4ce2787e5bb5a8b6f259f76bf');
});

test('compatibility upgrade is deterministic and does not need execution', () => {
  const input = fixture('v0-cortex-handoff.json');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-v1-determinism-'));
  const compiled = compileCanonicalAgentWork({ input, outputDir: out, options: { runId: 'determinism-run' } });
  const first = upgradeAgentWorkV0ToV1({ handoff: compiled.handoff, runContract: compiled.runContract, canonicalManifest: compiled.canonicalManifest });
  const second = upgradeAgentWorkV0ToV1({ handoff: compiled.handoff, runContract: compiled.runContract, canonicalManifest: compiled.canonicalManifest });
  assert.equal(first.runManifest.planDigest, second.runManifest.planDigest);
  assert.equal(first.validation.ok, true);
  assert.equal(fs.existsSync(path.join(out, 'canonical_execution_result.json')), false);
});

test('canonical compilation materializes the complete Phase 1 v1 contract bundle', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-v1-files-'));
  const compiled = compileCanonicalAgentWork({
    input: fixture('v0-cortex-handoff.json'),
    outputDir: out,
    options: { runId: 'materialization-run' }
  });
  assert.equal(compiled.canonicalManifest.compileGreen, true);
  assert.equal(compiled.canonicalManifest.contractFreezeGreen, true);
  assert.equal(compiled.canonicalManifest.contractBundleSchemaVersion, 'clawd.agent_work.contract_bundle.v1');
  for (const file of ['objective_contract.json', 'permission_contract.json', 'budget_contract.json', 'run_manifest.json', 'task_contracts.json', 'agent_work_v1_contract_bundle.json']) {
    assert.equal(fs.existsSync(path.join(out, file)), true, file);
  }
  assert.equal(readJson(path.join(out, 'task_contracts.json')).length, 2);
  assert.equal(readJson(path.join(out, 'agent_work_v1_contract_bundle.json')).validation.ok, true);
});

test('authority matrix assigns every consequential decision to one authority', () => {
  const matrix = readJson(path.join(root, 'config/agent-work-v1/authority-matrix.json'));
  const validation = validateAuthorityMatrix(matrix);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.equal(validation.decisionCount, 14);
  assert.equal(matrix.decisions.every((entry) => Array.isArray(entry.currentDuplicateLocations)), true);

  const invalid = clone(matrix);
  invalid.decisions.find((entry) => entry.id === 'terminal_truth').authority = 'another-terminal-authority';
  assert.equal(validateAuthorityMatrix(invalid).errors.some((error) => error.includes('must share one truth authority')), true);
});

test('architecture policy rejects new Agent Work product scripts that bypass the facade', () => {
  const packageJson = readJson(path.join(root, 'package.json'));
  const policy = readJson(path.join(root, 'config/agent-work-v1/architecture-policy.json'));
  assert.equal(validateCanonicalEntrypoints({ packageJson, policy }).ok, true);

  const bypass = clone(packageJson);
  bypass.scripts['agent-work:unsafe:bypass'] = 'node apps/system-benchmark/run-agent-work-objective-controller.mjs unsafe.json';
  const validation = validateCanonicalEntrypoints({ packageJson: bypass, policy });
  assert.equal(validation.ok, false);
  assert.equal(validation.errors.some((error) => error.includes('bypasses facade')), true);
});

test('Phase 1 contract and authority documentation is present', () => {
  for (const file of ['SCHEMA_CATALOG.md', 'COMPONENT_AUTHORITY_MATRIX.md', 'PUBLIC_FACADE_BEHAVIOR.md']) {
    const target = path.join(root, 'docs/agent-work-v1', file);
    assert.equal(fs.existsSync(target), true, file);
    assert.equal(fs.readFileSync(target, 'utf8').length > 1000, true, file);
  }
});
