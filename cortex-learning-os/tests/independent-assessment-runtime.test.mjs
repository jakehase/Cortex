import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { verifyAdaptiveArtifacts } from '../src/adaptive-verifier.mjs';
import { buildDeploymentBinding, deploymentBindingDigest } from '../src/deployment-identity.mjs';
import { generateExercise } from '../src/generated-exercises.mjs';
import { sha256Text } from '../src/hash.mjs';
import { validateJsonSchema } from '../src/json-schema-validation.mjs';
import {
  executeIndependentAssessmentFixtureItem,
  INDEPENDENT_ASSESSMENT_BANK_SCHEMA,
  INDEPENDENT_ASSESSMENT_ITEM_SCHEMA,
  INDEPENDENT_CHECKER_RUNTIME,
  independentAssessmentAttestationPayload,
  independentAssessmentBankAttestationPayload,
  independentAssessmentBankDigest,
  independentAssessmentContentDigest,
  validateIndependentAssessmentFixtureBank,
  validateIndependentAssessmentFixtureItem,
} from '../src/phd-assessment.mjs';
import { loadCanonicalPhdProgram } from '../src/phd-program-runtime.mjs';
import {
  buildRetentionWindowTask,
  gradeRetentionWindow,
  releaseRetentionWindow,
} from '../src/phd-retention.mjs';
import { AUTHORITY_ATTESTATION_SCHEMA } from '../src/phd-trust.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

function authority(authorityId, capability) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    authorityId,
    capability,
    privateKey,
    policyRecord: {
      authorityId,
      capabilities: [capability],
      publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      keyId: sha256Text(publicKey.export({ format: 'der', type: 'spki' })),
    },
  };
}

function signAuthority(authorityRecord, attestationId, payload) {
  const core = {
    schemaVersion: AUTHORITY_ATTESTATION_SCHEMA,
    attestationId,
    authorityId: authorityRecord.authorityId,
    payload,
  };
  return {
    ...core,
    signature: {
      algorithm: 'ed25519',
      keyId: authorityRecord.policyRecord.keyId,
      valueBase64: crypto.sign(
        null,
        Buffer.from(canonicalJson(core), 'utf8'),
        authorityRecord.privateKey,
      ).toString('base64'),
    },
  };
}

function controlledFixture() {
  const graph = read('capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json');
  const rubric = read('capsules/math-foundations/phd-competency-rubric.v1.json');
  const author = authority('fixture-independent-author', 'bank_authoring');
  const reviewer = authority('fixture-independent-reviewer', 'bank_review');
  const trustPolicy = {
    schemaVersion: 'cortex.learning_os.phd_trust_policy.v1',
    policyId: 'independent-assessment-fixture-trust',
    boundaryId: 'independent-assessment-fixture-boundary',
    productionEnabled: false,
    authorities: [author.policyRecord, reviewer.policyRecord],
    truthBoundary: 'Ephemeral test keys validate independent item and bank signature mechanics only.',
  };
  const deployment = buildDeploymentBinding({
    sourceCommit: '1'.repeat(40),
    sourceTree: '2'.repeat(40),
    artifacts: { graph, rubric, 'trust-policy': trustPolicy },
  });
  const campaign = {
    campaignId: 'controlled-assessment-fixture',
    campaignDigest: '3'.repeat(64),
  };
  const bindings = {
    trustPolicyDigest: sha256Text(canonicalJson(trustPolicy)),
    deploymentDigest: deploymentBindingDigest(deployment),
    campaign,
  };
  const concept = graph.concepts.find((row) => row.conceptId === 'number-fractions');
  const mapping = rubric.conceptMappings.find((row) => row.conceptId === concept.conceptId);
  const promptBytes = Buffer.from('Compute 1/2 + 1/3 exactly. Return a reduced fraction.', 'utf8');
  const specification = {
    mode: 'exact_string',
    expected: '5/6',
    caseSensitive: true,
  };
  const item = {
    schemaVersion: INDEPENDENT_ASSESSMENT_ITEM_SCHEMA,
    itemId: 'fixture-independent-fractions-001',
    fixtureOnly: true,
    assessmentClass: 'controlled_fixture_only',
    assessmentRole: 'acquisition',
    content: {
      encoding: 'base64',
      mediaType: 'text/plain; charset=utf-8',
      promptBase64: promptBytes.toString('base64'),
    },
    contentSha256: sha256Text(promptBytes),
    answerFormat: 'reduced fraction',
    conceptId: concept.conceptId,
    outcomeIds: concept.outcomes.map((outcome) => `outcome:${sha256Text(outcome)}`),
    stage: mapping.stage,
    trackIds: structuredClone(mapping.tracks),
    semanticFamilyId: 'fixture-rational-addition-family-001',
    checker: {
      runtime: INDEPENDENT_CHECKER_RUNTIME,
      specification,
      specificationSha256: sha256Text(canonicalJson(specification)),
    },
    resourceLimits: {
      maxPromptBytes: 4096,
      maxAnswerBytes: 1024,
      maxCheckerRuntimeMs: 1000,
    },
    toolsPolicy: {
      allowed: false,
      policy: 'no_tools',
    },
    bindings,
    truthBoundary: 'Controlled signed fixture for trust and deterministic checker tests only; it is not production evidence.',
  };
  item.contentDigest = independentAssessmentContentDigest(item);
  item.authorAttestation = signAuthority(
    author,
    'fixture-item-author-attestation',
    independentAssessmentAttestationPayload(item, 'author'),
  );
  item.reviewerAttestation = signAuthority(
    reviewer,
    'fixture-item-review-attestation',
    independentAssessmentAttestationPayload(item, 'reviewer'),
  );
  const bank = {
    schemaVersion: INDEPENDENT_ASSESSMENT_BANK_SCHEMA,
    bankId: 'fixture-independent-acquisition-bank',
    fixtureOnly: true,
    assessmentClass: 'controlled_fixture_only',
    purpose: 'acquisition',
    bindings,
    items: [item],
    truthBoundary: 'Controlled one-item signed fixture bank; it is incomplete and cannot qualify production acquisition.',
  };
  bank.bankDigest = independentAssessmentBankDigest(bank);
  bank.authorAttestation = signAuthority(
    author,
    'fixture-bank-author-attestation',
    independentAssessmentBankAttestationPayload(bank, 'author'),
  );
  bank.reviewerAttestation = signAuthority(
    reviewer,
    'fixture-bank-review-attestation',
    independentAssessmentBankAttestationPayload(bank, 'reviewer'),
  );
  return {
    author,
    reviewer,
    trustPolicy,
    deployment,
    campaign,
    graph,
    rubric,
    item,
    bank,
  };
}

function signedItem({
  fixture,
  deployment,
  campaign,
  conceptId,
  itemId,
  semanticFamilyId,
  prompt,
  expected,
  role = 'retention',
}) {
  const concept = fixture.graph.concepts.find((row) => row.conceptId === conceptId);
  const mapping = fixture.rubric.conceptMappings.find((row) => row.conceptId === conceptId);
  const promptBytes = Buffer.from(prompt, 'utf8');
  const specification = { mode: 'exact_string', expected, caseSensitive: false };
  const item = {
    schemaVersion: INDEPENDENT_ASSESSMENT_ITEM_SCHEMA,
    itemId,
    fixtureOnly: true,
    assessmentClass: 'controlled_fixture_only',
    assessmentRole: role,
    content: {
      encoding: 'base64',
      mediaType: 'text/plain; charset=utf-8',
      promptBase64: promptBytes.toString('base64'),
    },
    contentSha256: sha256Text(promptBytes),
    answerFormat: 'short exact answer',
    conceptId,
    outcomeIds: concept.outcomes.map((outcome) => `outcome:${sha256Text(outcome)}`),
    stage: mapping.stage,
    trackIds: structuredClone(mapping.tracks),
    semanticFamilyId,
    checker: {
      runtime: INDEPENDENT_CHECKER_RUNTIME,
      specification,
      specificationSha256: sha256Text(canonicalJson(specification)),
    },
    resourceLimits: {
      maxPromptBytes: 4096,
      maxAnswerBytes: 1024,
      maxCheckerRuntimeMs: 1000,
    },
    toolsPolicy: { allowed: false, policy: 'no_tools' },
    bindings: {
      trustPolicyDigest: sha256Text(canonicalJson(fixture.trustPolicy)),
      deploymentDigest: deploymentBindingDigest(deployment),
      campaign,
    },
    truthBoundary: 'Controlled independently signed retention fixture; it is not production evidence.',
  };
  item.contentDigest = independentAssessmentContentDigest(item);
  item.authorAttestation = signAuthority(
    fixture.author,
    `${itemId}-author`,
    independentAssessmentAttestationPayload(item, 'author'),
  );
  item.reviewerAttestation = signAuthority(
    fixture.reviewer,
    `${itemId}-reviewer`,
    independentAssessmentAttestationPayload(item, 'reviewer'),
  );
  return item;
}

function signedBank({ fixture, deployment, campaign, items, bankId, purpose }) {
  const bank = {
    schemaVersion: INDEPENDENT_ASSESSMENT_BANK_SCHEMA,
    bankId,
    fixtureOnly: true,
    assessmentClass: 'controlled_fixture_only',
    purpose,
    bindings: {
      trustPolicyDigest: sha256Text(canonicalJson(fixture.trustPolicy)),
      deploymentDigest: deploymentBindingDigest(deployment),
      campaign,
    },
    items,
    truthBoundary: 'Controlled signed bank for runtime trust tests only; it is not production evidence.',
  };
  bank.bankDigest = independentAssessmentBankDigest(bank);
  bank.authorAttestation = signAuthority(
    fixture.author,
    `${bankId}-author`,
    independentAssessmentBankAttestationPayload(bank, 'author'),
  );
  bank.reviewerAttestation = signAuthority(
    fixture.reviewer,
    `${bankId}-reviewer`,
    independentAssessmentBankAttestationPayload(bank, 'reviewer'),
  );
  return bank;
}

test('signed independently authored bytes execute under controlled fixture trust', () => {
  const fixture = controlledFixture();
  const options = {
    graph: fixture.graph,
    rubric: fixture.rubric,
    trustPolicy: fixture.trustPolicy,
    deployment: fixture.deployment,
    campaignBinding: fixture.campaign,
  };
  assert.equal(validateIndependentAssessmentFixtureItem(fixture.item, options).ok, true);
  assert.equal(validateIndependentAssessmentFixtureBank(fixture.bank, options).ok, true);
  const result = executeIndependentAssessmentFixtureItem({
    item: fixture.item,
    answer: '5/6',
    ...options,
    bank: fixture.bank,
  });
  assert.equal(result.grading.passed, true);
  assert.equal(result.item.prompt, 'Compute 1/2 + 1/3 exactly. Return a reduced fraction.');
  assert.equal(result.item.fixtureOnly, true);
  assert.equal(result.item.independentAssessment.fixtureOnly, true);
  assert.equal(result.item.independentAssessment.assessmentClass, 'controlled_fixture_only');
  assert.equal(result.item.truthBoundary, fixture.item.truthBoundary);
  assert.equal(result.item.independentAssessment.bankDigest, fixture.bank.bankDigest);
});

test('prompt tampering and checker substitution fail against immutable signed item bytes', () => {
  const fixture = controlledFixture();
  const options = {
    graph: fixture.graph,
    rubric: fixture.rubric,
    trustPolicy: fixture.trustPolicy,
    deployment: fixture.deployment,
    campaignBinding: fixture.campaign,
  };
  const promptTamper = structuredClone(fixture.item);
  promptTamper.content.promptBase64 = Buffer.from('Compute 1/2 + 1/2.', 'utf8').toString('base64');
  assert.equal(validateIndependentAssessmentFixtureItem(promptTamper, options).ok, false);

  const checkerSubstitution = structuredClone(fixture.item);
  checkerSubstitution.checker.specification.expected = '1';
  checkerSubstitution.checker.specificationSha256 = sha256Text(
    canonicalJson(checkerSubstitution.checker.specification),
  );
  checkerSubstitution.contentDigest = independentAssessmentContentDigest(checkerSubstitution);
  const substitution = validateIndependentAssessmentFixtureItem(checkerSubstitution, options);
  assert.equal(substitution.ok, false);
  assert.match(substitution.errors.join('; '), /attestation/);
});

test('signed item and bank truth boundaries reject unauthenticated substitution', () => {
  const fixture = controlledFixture();
  const options = {
    graph: fixture.graph,
    rubric: fixture.rubric,
    trustPolicy: fixture.trustPolicy,
    deployment: fixture.deployment,
    campaignBinding: fixture.campaign,
  };
  const itemSubstitution = structuredClone(fixture.item);
  itemSubstitution.truthBoundary = 'Substituted item claim.';
  const itemValidation = validateIndependentAssessmentFixtureItem(itemSubstitution, options);
  assert.equal(itemValidation.ok, false);
  assert.match(itemValidation.errors.join('; '), /content digest mismatch|attestation/);

  const bankSubstitution = structuredClone(fixture.bank);
  bankSubstitution.truthBoundary = 'Substituted bank claim.';
  const bankValidation = validateIndependentAssessmentFixtureBank(bankSubstitution, options);
  assert.equal(bankValidation.ok, false);
  assert.match(bankValidation.errors.join('; '), /bank digest mismatch|attestation/);
});

test('execution rejects substituted bank identity metadata', () => {
  const fixture = controlledFixture();
  assert.throws(
    () => executeIndependentAssessmentFixtureItem({
      item: fixture.item,
      answer: '5/6',
      graph: fixture.graph,
      rubric: fixture.rubric,
      trustPolicy: fixture.trustPolicy,
      deployment: fixture.deployment,
      campaignBinding: fixture.campaign,
      bank: {
        bankId: 'substituted-bank',
        bankDigest: 'f'.repeat(64),
      },
    }),
    /bank.*invalid|substitut/i,
  );
});

test('item JSON Schema and runtime checker modes share one closed value domain', () => {
  const fixture = controlledFixture();
  const schemaPath = path.join(root, 'schemas/independent-assessment-item-v1.schema.json');
  const productionShape = {
    ...structuredClone(fixture.item),
    fixtureOnly: false,
    assessmentClass: 'independently_authored_concept_specific',
  };
  productionShape.contentDigest = independentAssessmentContentDigest(productionShape);
  assert.equal(validateJsonSchema(productionShape, schemaPath).ok, true);

  for (const specification of [
    { mode: 'unsupported_mode', expected: '5/6', caseSensitive: true },
    { mode: 'exact_number', expected: null },
    { mode: 'numeric_tolerance', expected: null, tolerance: 0 },
    {
      mode: 'exact_string',
      expected: '5/6',
      caseSensitive: true,
      untrustedExtension: true,
    },
  ]) {
    const candidate = structuredClone(productionShape);
    candidate.checker.specification = specification;
    candidate.checker.specificationSha256 = sha256Text(canonicalJson(specification));
    candidate.contentDigest = independentAssessmentContentDigest(candidate);
    assert.equal(validateJsonSchema(candidate, schemaPath).ok, false);
  }
});

test('synthetic exercises cannot enter the independent path and missing external banks stay non-green', () => {
  const fixture = controlledFixture();
  const synthetic = generateExercise({
    conceptId: 'real-analysis-limits-sequences',
    seed: 'synthetic-advanced-rejection',
    role: 'acquisition',
  });
  assert.equal(validateIndependentAssessmentFixtureItem(synthetic, {
    graph: fixture.graph,
    rubric: fixture.rubric,
    trustPolicy: fixture.trustPolicy,
    deployment: fixture.deployment,
    campaignBinding: fixture.campaign,
  }).ok, false);
  assert.throws(
    () => verifyAdaptiveArtifacts({}),
    /external independently authored assessment bank/,
  );
  const runtime = loadCanonicalPhdProgram({
    sourceCommit: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    allowWorkingTreeFixtures: true,
  });
  assert.equal(runtime.assessmentCoverage.productionAssessmentRegistryReady, false);
  assert.equal(runtime.assessmentCoverage.externallySuppliedSignedBankCount, 0);
  assert.equal(runtime.productionTrustReady, false);
});

test('retention accepts a parallel signed independent-bank path with derived stage and track coverage', () => {
  const fixture = controlledFixture();
  const policy = {
    schemaVersion: 'cortex.learning_os.retention_policy.v1',
    policyId: 'controlled-retention-fixture',
    curriculumId: fixture.graph.curriculumId,
    capsuleId: fixture.graph.capsuleId,
    production: false,
    requiredWindows: 2,
    minimumSeparationSeconds: 10,
    maximumClockSkewSeconds: 300,
    minimumItemsPerWindow: 6,
    minimumScore: 0.8,
    minimumStageCoverage: 3,
    minimumTrackCoverage: 8,
    modelRuntime: {
      provider: 'openai-codex',
      model: 'gpt-fixture',
      thinking: 'xhigh',
      sandbox: 'read-only',
      toolsAllowed: false,
    },
    independence: {
      distinctSessionPerWindow: true,
      disjointItemIds: true,
      disjointTheoremIds: true,
      previousWindowDigestRequired: true,
    },
  };
  const blueprint = { schemaVersion: 'controlled-blueprint-fixture.v1' };
  const acquisitionPolicy = { schemaVersion: 'controlled-acquisition-fixture.v1' };
  const deployment = buildDeploymentBinding({
    sourceCommit: '4'.repeat(40),
    sourceTree: '5'.repeat(40),
    artifacts: {
      graph: fixture.graph,
      rubric: fixture.rubric,
      blueprint,
      'acquisition-policy': acquisitionPolicy,
      'retention-policy': policy,
      'trust-policy': fixture.trustPolicy,
    },
  });
  const campaign = {
    campaignId: 'controlled-retention-campaign',
    campaignDigest: '6'.repeat(64),
  };
  const specifications = [
    {
      conceptId: 'reasoning-truth-boundary',
      prompt: 'A frozen corpus search finds no match. What is the strongest allowed novelty ceiling?',
      expected: 'bounded_corpus_only',
    },
    {
      conceptId: 'number-fractions',
      prompt: 'Compute 1/2 + 1/3 exactly as a reduced fraction.',
      expected: '5/6',
    },
    {
      conceptId: 'topology-separation-axioms',
      prompt: 'Does every discrete topological space satisfy the Hausdorff axiom? Answer yes or no.',
      expected: 'yes',
    },
    {
      conceptId: 'combinatorics-probabilistic-method',
      prompt: 'If the expected number of bad events is strictly below 1, does an outcome with zero bad events exist? Answer yes or no.',
      expected: 'yes',
    },
    {
      conceptId: 'set-theory-ordinals-transfinite',
      prompt: 'Write the successor ordinal of omega using ASCII.',
      expected: 'omega+1',
    },
    {
      conceptId: 'algebraic-topology-simplicial-cell-complexes',
      prompt: 'A finite cell complex has V=3, E=3, F=1. Compute V-E+F.',
      expected: '1',
    },
  ];
  const items = specifications.map((specification, index) => signedItem({
    fixture,
    deployment,
    campaign,
    ...specification,
    itemId: `controlled-retention-item-${index + 1}`,
    semanticFamilyId: `controlled-retention-family-${index + 1}`,
  }));
  const bank = signedBank({
    fixture,
    deployment,
    campaign,
    items,
    bankId: 'controlled-retention-bank',
    purpose: 'retention',
  });
  const programDigests = {
    graph: sha256Text(canonicalJson(fixture.graph)),
    rubric: sha256Text(canonicalJson(fixture.rubric)),
    blueprint: sha256Text(canonicalJson(blueprint)),
  };
  const acquisitionBinding = {
    subjectId: 'controlled-retention-subject',
    curriculumId: fixture.graph.curriculumId,
    policyDigest: deployment.contentDigests['acquisition-policy'],
    stateRevision: 1,
    stateDigest: '7'.repeat(64),
    completedAt: '2026-01-01T00:00:00.000Z',
  };
  const signingSecret = 'controlled-retention-signing-secret-000000000000000000';
  const task = buildRetentionWindowTask({
    taskId: 'controlled.retention.window.1',
    subjectId: acquisitionBinding.subjectId,
    windowIndex: 1,
    deployment,
    programDigests,
    policy,
    acquisitionBinding,
    assessmentBank: bank,
    graph: fixture.graph,
    rubric: fixture.rubric,
    trustPolicy: fixture.trustPolicy,
    issuedAt: '2026-01-02T00:00:00.000Z',
    signingSecret,
    fixtureOnly: true,
  });
  const release = releaseRetentionWindow({
    task,
    assessmentBank: bank,
    graph: fixture.graph,
    rubric: fixture.rubric,
    policy,
    deployment,
    trustPolicy: fixture.trustPolicy,
    signingSecret,
    now: task.notBefore,
    fixtureOnly: true,
  });
  assert.equal(canonicalJson(release).includes('"checker"'), false);
  const completedAt = '2026-01-02T00:00:02.000Z';
  const evidence = gradeRetentionWindow({
    task,
    assessmentBank: bank,
    graph: fixture.graph,
    rubric: fixture.rubric,
    attempt: {
      taskId: task.taskId,
      subjectId: task.subjectId,
      provider: policy.modelRuntime.provider,
      model: policy.modelRuntime.model,
      thinking: 'xhigh',
      sandbox: 'read-only',
      toolsAllowed: false,
      toolsUsed: [],
      usage: { inputTokens: 100, outputTokens: 20 },
      sessionId: 'controlled-retention-session-one',
      startedAt: '2026-01-02T00:00:01.000Z',
      completedAt,
      answers: items.map((item) => ({
        itemId: item.itemId,
        answer: item.checker.specification.expected,
      })),
    },
    policy,
    deployment,
    trustPolicy: fixture.trustPolicy,
    signingSecret,
    now: completedAt,
    fixtureOnly: true,
  });
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.items.every((item) => item.assessmentBankId === bank.bankId), true);
  assert.equal(new Set(evidence.items.map((item) => item.stage)).size, 3);
  assert.equal(new Set(evidence.items.flatMap((item) => item.tracks)).size >= 8, true);
});
