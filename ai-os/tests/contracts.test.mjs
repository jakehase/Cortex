import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

const schemaFiles = [
  'kernel/contracts/process.schema.json',
  'kernel/contracts/capability.schema.json',
  'kernel/contracts/syscall.schema.json',
  'kernel/contracts/claim.schema.json',
  'kernel/contracts/verifier.schema.json',
];

test('Wave 0 contract schema files parse and expose stable v0.1 identifiers', () => {
  for (const file of schemaFiles) {
    const schema = readJson(file);
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', file);
    assert.match(schema.$id, /^aios:\/\/kernel\/contracts\/.+\.schema\.json$/, file);
    assert.equal(schema.type, 'object', file);
    assert.equal(schema.additionalProperties, false, file);
    assert.ok(Array.isArray(schema.required), file);
    assert.ok(schema.required.includes('schemaVersion'), file);
    assert.ok(schema.properties?.schemaVersion?.const?.endsWith('v0.1'), file);
  }
});

test('kernel contract references every contract schema and defines safe lifecycle invariants', () => {
  const contract = readJson('kernel/contracts/kernel_contract.json');
  assert.equal(contract.schemaVersion, 'aios.kernel-contract.v0.1');
  assert.deepEqual(contract.contractFiles.sort(), schemaFiles.sort());
  assert.ok(contract.trustedKernelInvariants.some((rule) => rule.includes('cannot exit as completed')));
  assert.ok(contract.trustedKernelInvariants.some((rule) => rule.includes('Every syscall requires')));
  assert.ok(contract.processStates.includes('panic'));
  assert.ok(contract.allowedTransitions.some(([from, to]) => from === 'review_ready' && to === 'completed'));
});

test('prior-art reuse map requires adapters instead of duplicate SLOS/Cortex primitives', () => {
  const reuseMap = readJson('artifacts/aios-v0/latest/prior_art_reuse_map.json');
  assert.equal(reuseMap.decision, 'extend_existing_or_adapter_required');
  const systems = reuseMap.reuseTargets.map((target) => target.system);
  assert.ok(systems.some((system) => system.includes('Synthetic Labor OS')));
  assert.ok(systems.some((system) => system.includes('Cortex memory')));
  assert.ok(systems.some((system) => system.includes('Multi-agent orchestrator')));
  assert.ok(reuseMap.reuseTargets.every((target) => target.integrationDecision.includes('adapter') || target.integrationDecision.includes('mount') || target.integrationDecision.includes('reuse')));
});

test('run contract is a production-slice contract gate and does not claim runtime boot', () => {
  const run = readJson('artifacts/aios-v0/latest/run_contract.json');
  assert.equal(run.fidelity, 'production_slice');
  assert.equal(run.stopCondition, 'contracts_green_or_blocker_report');
  assert.equal(run.executionPlacement.executionPlaneRequired, false);
  assert.match(run.claimBoundary, /Must not claim AI OS boots/);
  for (const artifact of run.requiredArtifacts) {
    assert.ok(existsSync(join(root, artifact)), `missing required artifact ${artifact}`);
  }
});

test('verifier catalog points to this contract test and fails closed', () => {
  const catalog = readJson('artifacts/aios-v0/latest/verifier_catalog.json');
  assert.equal(catalog.schemaVersion, 'aios.verifier-catalog.v0.1');
  const verifier = catalog.verifiers.find((item) => item.id === 'verifier_contract_schema_static');
  assert.ok(verifier);
  assert.equal(verifier.command, 'node --test tests/contracts.test.mjs');
  assert.equal(verifier.failClosed, true);
  assert.equal(verifier.required, true);
});

test('token budget has bounded Wave 0 and gated Wave 1 spend', () => {
  const budget = readJson('artifacts/aios-v0/latest/token_budget_estimate.json');
  assert.equal(budget.schemaVersion, 'aios.token-budget-estimate.v0.1');
  assert.equal(budget.selectedCurrentCeiling.scope, 'Wave 0 contract implementation only');
  assert.ok(budget.selectedCurrentCeiling.maxTokens <= 100_000_000);
  const wave1 = budget.waveEstimates.find((wave) => wave.wave === 'Wave 1 hosted kernel boot proof');
  assert.ok(wave1);
  assert.equal(wave1.approvalRequiredBeforeSpend, true);
  assert.ok(wave1.highTokens >= 500_000_000);
});

test('boot sequence document separates contract proof from bounded runtime proof', () => {
  const doc = readFileSync(join(root, 'docs/BOOT_SEQUENCE.md'), 'utf8');
  assert.match(doc, /Contract tests alone are still not runtime proof/i);
  assert.match(doc, /compile\/boot\/run\/verifier\/claim artifact chain/i);
  assert.match(doc, /not native OS replacement, external-provider readiness, or full product parity/i);
});
