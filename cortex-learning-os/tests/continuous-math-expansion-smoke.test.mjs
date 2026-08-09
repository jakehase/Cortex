import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { loadSignedTransferRegistry, readTransferRegistrySecret } from '../../plugins/cortex-learning-os-live/transfer-registry.mjs';
import { buildAcquisitionStatus } from '../src/acquisition-status.mjs';
import { policyDigest } from '../src/adaptive-policy.mjs';
import { buildAdditiveMasteryMigration } from '../src/additive-mastery-migration.mjs';
import { buildDeploymentBinding, deploymentBindingDigest } from '../src/deployment-identity.mjs';
import { validateGeneratedExerciseCoverage } from '../src/generated-exercises.mjs';
import { currentCommittedIdentity } from '../src/git-product-source.mjs';
import { sha256Text } from '../src/hash.mjs';
import { readMasterySecret, verifyMasteryState } from '../src/mastery-state.mjs';
import {
  INDEPENDENT_ASSESSMENT_BANK_SCHEMA,
  INDEPENDENT_ASSESSMENT_ITEM_SCHEMA,
  INDEPENDENT_CHECKER_RUNTIME,
  independentAssessmentAttestationPayload,
  independentAssessmentBankAttestationPayload,
  independentAssessmentBankDigest,
  independentAssessmentContentDigest,
  validateIndependentAssessmentFixtureBank,
} from '../src/phd-assessment.mjs';
import { validatePhdProgram } from '../src/phd-competency.mjs';
import { AUTHORITY_ATTESTATION_SCHEMA } from '../src/phd-trust.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const stateRoot = process.env.CLOS_LIVE_STATE_ROOT || '/root/.openclaw/cortex-learning-os';

function authority(authorityId, capability) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    authorityId,
    privateKey,
    policyRecord: {
      authorityId,
      capabilities: [capability],
      publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      keyId: sha256Text(publicKey.export({ format: 'der', type: 'spki' })),
    },
  };
}
function sign(authorityRecord, attestationId, payload) {
  const core = { schemaVersion: AUTHORITY_ATTESTATION_SCHEMA, attestationId, authorityId: authorityRecord.authorityId, payload };
  return {
    ...core,
    signature: {
      algorithm: 'ed25519',
      keyId: authorityRecord.policyRecord.keyId,
      valueBase64: crypto.sign(null, Buffer.from(canonicalJson(core), 'utf8'), authorityRecord.privateKey).toString('base64'),
    },
  };
}
function fixtureItem({ role, suffix, graph, rubric, trustPolicy, deployment, campaign, author, reviewer }) {
  const concept = graph.concepts.find((row) => row.conceptId === 'information-theory-entropy-divergence');
  const mapping = rubric.conceptMappings.find((row) => row.conceptId === concept.conceptId);
  const prompt = role === 'validity-direct'
    ? 'For a fair bit X, return H(X) in bits as one exact number.'
    : 'For independent fair bits X and Y, return the ordered pair [H(X), I(X;Y)] in bits.';
  const specification = role === 'validity-direct'
    ? { mode: 'exact_number', expected: 1 }
    : { mode: 'ordered_numeric_tuple', expected: [1, 0] };
  const promptBytes = Buffer.from(prompt, 'utf8');
  const item = {
    schemaVersion: INDEPENDENT_ASSESSMENT_ITEM_SCHEMA,
    itemId: `fixture-validity-${suffix}`,
    fixtureOnly: true,
    assessmentClass: 'controlled_fixture_only',
    assessmentRole: role,
    content: { encoding: 'base64', mediaType: 'text/plain; charset=utf-8', promptBase64: promptBytes.toString('base64') },
    contentSha256: sha256Text(promptBytes),
    answerFormat: 'exact numeric response',
    conceptId: concept.conceptId,
    outcomeIds: concept.outcomes.map((outcome) => `outcome:${sha256Text(outcome)}`),
    stage: mapping.stage,
    trackIds: mapping.tracks,
    semanticFamilyId: `fixture-validity-family-${suffix}`,
    checker: { runtime: INDEPENDENT_CHECKER_RUNTIME, specification, specificationSha256: sha256Text(canonicalJson(specification)) },
    resourceLimits: { maxPromptBytes: 4096, maxAnswerBytes: 1024, maxCheckerRuntimeMs: 1000 },
    toolsPolicy: { allowed: false, policy: 'no_tools' },
    bindings: { trustPolicyDigest: sha256Text(canonicalJson(trustPolicy)), deploymentDigest: deploymentBindingDigest(deployment), campaign },
    truthBoundary: 'Controlled validity fixture only; no production or candidate evidence.',
  };
  item.contentDigest = independentAssessmentContentDigest(item);
  item.authorAttestation = sign(author, `${item.itemId}-author`, independentAssessmentAttestationPayload(item, 'author'));
  item.reviewerAttestation = sign(reviewer, `${item.itemId}-reviewer`, independentAssessmentAttestationPayload(item, 'reviewer'));
  return item;
}

test('continuous math wave-1 source, additive migration, validity bank, and operator subset are coherent', () => {
  const pipelineSource = fs.readFileSync(path.join(root, 'scripts/run_continuous_math_wave1_pipeline.py'), 'utf8');
  const supervisorSource = fs.readFileSync(path.join(root, 'scripts/supervise_continuous_math_commissioning.py'), 'utf8');
  const authorOutputSchema = read('schemas/continuous-math-bank-author-output.schema.json');
  assert.equal(JSON.stringify(authorOutputSchema).includes('uniqueItems'), false);
  assert.match(pipelineSource, /"readlink", "-f", "--", args\.remote_codex/);
  assert.match(pipelineSource, /"systemctl", "show", f"\{unit\}\.service"/);
  assert.match(pipelineSource, /remote commissioning unit terminated before publishing durable state/);
  assert.doesNotMatch(pipelineSource, /"systemd-run", f"--unit=\{unit\}", "--collect"/);
  assert.match(supervisorSource, /"status": "preparing"/);
  assert.match(supervisorSource, /required execution path must not be a symlink/);
  execFileSync('python3', ['-c', 'import ast,sys; [ast.parse(open(p, encoding="utf-8").read(), filename=p) for p in sys.argv[1:]]',
    path.join(root, 'scripts/commission_continuous_math_bank.py'),
    path.join(root, 'scripts/supervise_continuous_math_commissioning.py'),
    path.join(root, 'scripts/run_continuous_math_wave1_pipeline.py')]);
  execFileSync('bash', ['-n', path.join(root, 'scripts/launch-parallel-adaptive-wave.sh')]);
  const targetGraph = read('capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json');
  const sourceGraph = read('capsules/math-foundations/curriculum.phd-trajectory-v1.0.0-264.graph.json');
  const legacyGraph = read('capsules/math-foundations/curriculum.continuous-acquisition-v1.graph.json');
  const rubric = read('capsules/math-foundations/phd-competency-rubric.v1.json');
  const blueprint = read('capsules/math-foundations/phd-qualifying-blueprint.v1.json');
  const policy = read('policies/adaptive-math-phd-v1.json');
  const program = validatePhdProgram({ graph: targetGraph, rubric, blueprint, legacyGraph });
  assert.deepEqual(program.errors, []);
  assert.deepEqual(validateGeneratedExerciseCoverage(targetGraph).missing, []);
  assert.equal(targetGraph.version, '1.1.0');
  assert.equal(targetGraph.concepts.length, 288);
  assert.equal(rubric.conceptMappings.length, 288);
  assert.deepEqual(targetGraph.concepts.slice(0, 264), sourceGraph.concepts);

  const identity = currentCommittedIdentity({ requireClean: true });
  const masteryPath = path.join(stateRoot, 'mastery.json');
  const masterySecret = readMasterySecret(path.join(stateRoot, 'mastery.hmac'));
  const sourceState = JSON.parse(fs.readFileSync(masteryPath, 'utf8'));
  assert.equal(verifyMasteryState(sourceState, masterySecret, { graph: sourceGraph, policy }).ok, true);
  const built = buildAdditiveMasteryMigration({
    sourceState,
    secret: masterySecret,
    sourceGraph,
    sourcePolicy: policy,
    targetGraph,
    targetPolicy: policy,
    expectedSourceRevision: sourceState.revision,
    expectedSourceStateDigest: sha256Text(canonicalJson(sourceState)),
    expectedSourceGraphDigest: sha256Text(canonicalJson(sourceGraph)),
    expectedSourcePolicyDigest: policyDigest(policy),
    expectedTargetGraphDigest: sha256Text(canonicalJson(targetGraph)),
    expectedTargetPolicyDigest: policyDigest(policy),
    sourceCommit: identity.sourceCommit,
    expectedSourceCommit: identity.sourceCommit,
    sourceTree: identity.sourceTree,
    expectedSourceTree: identity.sourceTree,
  });
  assert.equal(Object.keys(built.targetState.concepts).length, 288);
  assert.equal(built.audit.addedConceptIds.length, 24);
  assert.ok(built.audit.addedConceptIds.every((conceptId) => built.targetState.concepts[conceptId].state === 'unassessed'));
  assert.deepEqual(Object.fromEntries(Object.entries(built.targetState.concepts).slice(0, 264)), sourceState.concepts);
  const status = buildAcquisitionStatus({ state: built.targetState, graph: targetGraph });
  assert.equal(status.unassessed.count, 24);
  assert.ok(status.frontier.count > 0);

  const author = authority('fixture-continuous-author', 'bank_authoring');
  const reviewer = authority('fixture-continuous-reviewer', 'bank_review');
  const trustPolicy = {
    schemaVersion: 'cortex.learning_os.phd_trust_policy.v1',
    policyId: 'continuous-validity-fixture-trust',
    boundaryId: 'continuous-validity-fixture-boundary',
    productionEnabled: false,
    authorities: [author.policyRecord, reviewer.policyRecord],
    truthBoundary: 'Ephemeral keys validate validity-purpose mechanics only.',
  };
  const deployment = buildDeploymentBinding({
    sourceCommit: '1'.repeat(40),
    sourceTree: '2'.repeat(40),
    artifacts: { graph: targetGraph, rubric, 'trust-policy': trustPolicy },
  });
  const campaign = { campaignId: 'controlled-validity-fixture', campaignDigest: '3'.repeat(64) };
  const items = [
    fixtureItem({ role: 'validity-direct', suffix: 'direct', graph: targetGraph, rubric, trustPolicy, deployment, campaign, author, reviewer }),
    fixtureItem({ role: 'validity-compositional', suffix: 'compositional', graph: targetGraph, rubric, trustPolicy, deployment, campaign, author, reviewer }),
  ];
  const bank = {
    schemaVersion: INDEPENDENT_ASSESSMENT_BANK_SCHEMA,
    bankId: 'fixture-independent-validity-bank',
    fixtureOnly: true,
    assessmentClass: 'controlled_fixture_only',
    purpose: 'validity',
    bindings: items[0].bindings,
    items,
    truthBoundary: 'Controlled signed validity bank fixture only.',
  };
  bank.bankDigest = independentAssessmentBankDigest(bank);
  bank.authorAttestation = sign(author, 'fixture-validity-bank-author', independentAssessmentBankAttestationPayload(bank, 'author'));
  bank.reviewerAttestation = sign(reviewer, 'fixture-validity-bank-reviewer', independentAssessmentBankAttestationPayload(bank, 'reviewer'));
  assert.equal(validateIndependentAssessmentFixtureBank(bank, { graph: targetGraph, rubric, trustPolicy, deployment, campaignBinding: campaign }).ok, true);

  const registry = loadSignedTransferRegistry(
    path.join(stateRoot, 'transfer-registry.json'),
    readTransferRegistrySecret(path.join(stateRoot, 'transfer-registry.hmac')),
    { allowExpiredEntries: true },
  );
  const targetIds = new Set(targetGraph.concepts.map((row) => row.conceptId));
  assert.equal(registry.entries.length, 264);
  assert.ok(registry.entries.every((entry) => entry.conceptIds.length === 1 && targetIds.has(entry.conceptIds[0])));
});
