import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  validateAcquisitionAssessmentRegistryMetadata,
  validateProofRuntimeReplayChain,
  validateProductionAcquisitionAssessmentRegistry,
  verifyPhdCampaign,
} from '../src/phd-campaign.mjs';
import { validateProductionControlBundle } from '../src/phd-control-boundary.mjs';
import {
  bindApprovedModelExecutable,
  deploymentBindingDigest,
  sourceDeploymentBinding,
} from '../src/deployment-identity.mjs';
import {
  createExecutionEvidenceCore,
  executionEvidenceSha256,
} from '../src/execution-evidence.mjs';
import { sha256Text } from '../src/hash.mjs';
import { loadCanonicalPhdProgram } from '../src/phd-program-runtime.mjs';
import { buildLayeredPhdStatus } from '../src/phd-status.mjs';
import { CLOS_ROOT } from '../src/paths.mjs';
import {
  RETENTION_STATUS_SCHEMA,
  verifyProductionRetentionQualification,
  verifyRetentionStatusRecord,
} from '../src/phd-retention.mjs';
import {
  cycle7ApprovedResearchRuntimeBinding,
  cycle10QualificationDeployment,
} from './research-runtime-fixture.mjs';

const signingSecret = 'final-boundary-negative-test-secret-000000000000000000';
const runtime = loadCanonicalPhdProgram({
  sourceCommit: 'a'.repeat(40),
  sourceTree: 'b'.repeat(40),
  allowWorkingTreeFixtures: true,
});

function digest(value) {
  return sha256Text(canonicalJson(value));
}

function sign(payload) {
  return {
    ...payload,
    controlPlaneSignature: {
      algorithm: 'hmac-sha256',
      keyId: sha256Text(signingSecret).slice(0, 16),
      digest: crypto.createHmac('sha256', signingSecret)
        .update(canonicalJson(payload))
        .digest('hex'),
    },
  };
}

function metadataRegistry() {
  const bankId = 'metadata-only-acquisition-bank';
  const bankDigest = '1'.repeat(64);
  const campaign = {
    campaignId: 'metadata-only-acquisition-campaign',
    campaignDigest: '2'.repeat(64),
  };
  return runtime.graph.concepts.map((concept, index) => {
    const mapping = runtime.rubric.conceptMappings.find((row) => (
      row.conceptId === concept.conceptId
    ));
    return {
      schemaVersion: 'cortex.learning_os.acquisition_assessment_registry_entry.v2',
      assessmentId: `metadata-only-assessment-${index}`,
      bankId,
      bankDigest,
      itemContentDigest: sha256Text(`metadata-item-${index}`),
      checkerSpecificationSha256: sha256Text(`metadata-checker-${index}`),
      conceptId: concept.conceptId,
      theoremFamilyId: `metadata-only-family-${index}`,
      assessmentClass: 'independently_authored_concept_specific',
      assessmentRole: 'acquisition',
      productionEligible: true,
      outcomeIds: concept.outcomes.map((outcome) => `outcome:${sha256Text(outcome)}`),
      stage: mapping.stage,
      trackIds: structuredClone(mapping.tracks),
      trustPolicyDigest: sha256Text(canonicalJson(runtime.trustPolicy)),
      deploymentDigest: deploymentBindingDigest(runtime.deployment),
      campaign,
      authorAuthorityId: 'metadata-only-author',
      reviewerAuthorityId: 'metadata-only-reviewer',
    };
  });
}

function statusFor(windows = null) {
  const firstInterval = {
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    notBefore: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-02T00:00:00.000Z',
  };
  const secondInterval = {
    startedAt: '2026-01-08T00:00:01.000Z',
    completedAt: '2026-01-08T00:00:02.000Z',
    notBefore: '2026-01-08T00:00:01.000Z',
    expiresAt: '2026-01-09T00:00:01.000Z',
  };
  const executionEvidenceRecords = windows
    ? windows.map((window) => ({
      core: window.execution.executionEvidenceCore,
      executionEvidenceSha256: window.execution.executionEvidenceSha256,
    }))
    : [executionRecord(1), executionRecord(2)];
  return sign({
    schemaVersion: RETENTION_STATUS_SCHEMA,
    subjectId: 'false-retained-subject',
    evaluatedAt: '2026-01-08T00:00:03.000Z',
    fixtureOnly: false,
    campaignBinding: {
      campaignId: 'negative-test-retention-campaign',
      campaignDigest: '8'.repeat(64),
    },
    status: 'retained_mastery_qualified',
    completedWindowCount: 2,
    requiredWindowCount: 2,
    windowEvidenceDigests: windows
      ? windows.map((window) => digest(window))
      : ['3'.repeat(64), '4'.repeat(64)],
    executionAttestationDigests: windows
      ? windows.map((window) => window.executionAttestationDigest)
      : ['5'.repeat(64), '6'.repeat(64)],
    executionEvidenceRecords,
    authenticatedWindowIntervals: [firstInterval, secondInterval],
    nextEligibleAt: null,
    errors: [],
    deploymentDigest: deploymentBindingDigest(runtime.deployment),
    acquisitionStateDigest: '7'.repeat(64),
    retainedMasteryQualified: true,
    truthBoundary: 'Only the declared signed two-window retention contract is qualified; this does not establish unrestricted mastery or a degree.',
  });
}

function executionRecord(index) {
  const core = createExecutionEvidenceCore({
    executionKind: 'process',
    bindings: {
      candidateId: 'false-retained-subject',
      candidateSessionId: `negative-retention-session-${index}`,
      candidateSha256: String(index).repeat(64),
      taskId: `negative-retention-task-${index}`,
      taskSha256: String(index + 2).repeat(64),
      jobId: `negative-retention-job-${index}`,
      jobSha256: String(index + 4).repeat(64),
      campaignId: 'negative-test-retention-campaign',
      campaignSha256: '8'.repeat(64),
      deploymentSha256: deploymentBindingDigest(runtime.deployment),
      sourceSha256: String(index + 6).repeat(64),
    },
    declaredEnvironment: { role: 'retention' },
    observedEnvironment: { fixture: `negative-${index}` },
    requestedArgv: ['/fixture/process'],
    executedArgv: ['/fixture/process'],
    executable: {
      invoked: '/fixture/process',
      resolvedPath: '/fixture/process',
      bytes: 1,
      sha256: String(index + 7).repeat(64),
    },
    cwd: '/fixture',
    startedAt: `2026-01-0${index}T00:00:00.000Z`,
    completedAt: `2026-01-0${index}T00:00:01.000Z`,
    exitCode: 0,
    input: {
      name: 'prompt',
      mediaType: 'text/plain',
      bytes: Buffer.from(`negative-${index}`),
    },
    stdout: Buffer.from(`negative-output-${index}`),
    stderr: Buffer.alloc(0),
    outputFiles: [],
  });
  return {
    core,
    executionEvidenceSha256: executionEvidenceSha256(core),
  };
}

function bank(index) {
  return {
    bankId: `negative-test-retention-bank-${index}`,
    bankDigest: String(index).repeat(64),
    bindings: {
      campaign: {
        campaignId: 'negative-test-retention-campaign',
        campaignDigest: '8'.repeat(64),
      },
    },
  };
}

function window(index, assessmentBank, {
  startedAt,
  completedAt,
  itemId = `retention-item-${index}`,
  conceptId = `retention-concept-${index}`,
  outcomeId = `outcome:${String(index).repeat(64)}`,
  semanticFamilyId = `retention-family-${index}`,
} = {}) {
  const attestation = {
    schemaVersion: 'negative-test.execution-attestation',
    payload: { executionId: `negative-test-execution-${index}` },
  };
  const executionEvidence = executionRecord(index);
  return {
    windowIndex: index,
    startedAt,
    completedAt,
    assessmentBankRecordDigest: digest(assessmentBank),
    sealedItemBankDigest: assessmentBank.bankDigest,
    assessmentBankId: assessmentBank.bankId,
    assessmentCampaign: assessmentBank.bindings.campaign,
    executionAttestationDigest: digest(attestation),
    executionEvidenceSha256: executionEvidence.executionEvidenceSha256,
    execution: {
      attestation,
      executionEvidenceCore: executionEvidence.core,
      executionEvidenceSha256: executionEvidence.executionEvidenceSha256,
    },
    items: [{
      itemId,
      theoremId: `theorem:${semanticFamilyId}`,
      semanticFamilyId,
      conceptId,
      outcomeIds: [outcomeId],
    }],
  };
}

function retentionArguments(status, windows, assessmentBanks) {
  return {
    status,
    windows,
    assessmentBanks,
    policy: runtime.retentionPolicy,
    deployment: runtime.deployment,
    trustPolicy: runtime.trustPolicy,
    campaignBinding: {
      campaignId: 'negative-test-retention-campaign',
      campaignDigest: '8'.repeat(64),
    },
    acquisitionBinding: {
      subjectId: status.subjectId,
      curriculumId: runtime.graph.curriculumId,
      policyDigest: runtime.deployment.contentDigests['acquisition-policy'],
      stateRevision: 1,
      stateDigest: status.acquisitionStateDigest,
      completedAt: '2025-12-31T00:00:00.000Z',
    },
    graph: runtime.graph,
    rubric: runtime.rubric,
    signingSecret,
  };
}

test('final campaign path composes exact runtime, canonical execution, and signed-bank retention evidence', () => {
  const campaignBoundary = verifyPhdCampaign.toString();
  assert.match(campaignBoundary, /validateProofRuntimeReplayChain/);
  assert.match(campaignBoundary, /verifyProductionRetentionQualification/);
  assert.match(campaignBoundary, /retentionExecutionEvidenceRecords/);
  assert.match(campaignBoundary, /executionEvidenceQualified/);
  assert.match(campaignBoundary, /verifyQualificationHarvestEvidence/);
  assert.match(campaignBoundary, /artifactManifestBytesByJob/);
  assert.match(campaignBoundary, /artifactFileBytesByJob/);
  assert.match(campaignBoundary, /assembledHarvestBindingMatches/);
  assert.match(campaignBoundary, /harvestedReproductionBundleMatches/);
  assert.match(campaignBoundary, /harvestedRetentionWindowMatches/);
  assert.match(campaignBoundary, /modelCallsByJob/);
  assert.match(campaignBoundary, /exactHarvestedModelCallMatches/);
  assert.match(campaignBoundary, /canonicalJson\(researchMainProofJob[.]task\)/);
  assert.match(campaignBoundary, /canonicalJson\(materializationProofTask\)/);
  assert.match(campaignBoundary, /request[.]proofTaskSha256 !== digest\(authenticatedProofTask\)/);
  const campaignSource = fs.readFileSync(
    path.join(CLOS_ROOT, 'src/phd-campaign.mjs'),
    'utf8',
  );
  assert.ok(
    (campaignSource.match(/productionHarvestBindingForWorker\(\{/g) || []).length >= 4,
    'the helper plus all three production assemblers must consume the signed harvest',
  );
  assert.doesNotMatch(campaignSource, /now:\s*workerCall[?][.]completedAt/);
  assert.doesNotMatch(campaignSource, /now:\s*reproductionBundle[?][.]completedAt/);
  assert.ok(
    (campaignSource.match(/now:\s*harvestObservedAt/g) || []).length >= 3,
    'exam, proof/replay, and research assembly must observe harvest after collection',
  );
  const qualificationControl = fs.readFileSync(
    path.join(CLOS_ROOT, 'src/phd-qualification-control.mjs'),
    'utf8',
  );
  assert.match(qualificationControl, /const controlPlaneObservedAt = new Date\(\)[.]toISOString\(\)/);
  assert.match(qualificationControl, /now:\s*controlPlaneObservedAt/);
  assert.match(
    qualificationControl,
    /verifyAndAtomicWritePhdCampaignReport\s*\(\s*value\('--out'\),\s*bundle,\s*signingSecret/,
  );
  assert.match(qualificationControl, /bundlePath:\s*value\('--bundle-out'\)/);
  assert.match(
    campaignSource,
    /production campaign report publication requires a brokered underlying bundle target/,
  );
  assert.match(campaignSource, /phdCampaignVerificationBundleSha256/);
  assert.match(campaignSource, /verificationBundleSha256/);
  assert.match(
    campaignSource,
    /qualified campaign verification requires the exact brokered underlying bundle digest/,
  );

  const runtimeBoundary = validateProofRuntimeReplayChain.toString();
  assert.match(runtimeBoundary, /validateProofRuntimeEvidence/);
  assert.match(runtimeBoundary, /proofRuntimeAttestationSha256/);
  assert.match(runtimeBoundary, /requestBytesBase64/);
  assert.match(runtimeBoundary, /requestSha256/);
  assert.match(runtimeBoundary, /validateCapabilityAuthorityIndependence/);

  const retentionBoundary = verifyProductionRetentionQualification.toString();
  assert.match(retentionBoundary, /assessmentBanks\.length !== 2/);
  assert.match(retentionBoundary, /validateExecutionEvidenceRecord/);
  const retentionSource = fs.readFileSync(
    path.join(CLOS_ROOT, 'src/phd-retention.mjs'),
    'utf8',
  );
  assert.match(retentionSource, /serviceUser \|\| 'cortex-retention'/);
  assert.match(retentionSource, /dedicated non-root identity/);
  assert.match(retentionSource, /ancestorChainSha256/);
  assert.match(retentionBoundary, /executionEvidenceRecords/);
});

test('production gate and status paths recompute the complete campaign bundle before accepting a report', () => {
  const gateSource = fs.readFileSync(path.join(CLOS_ROOT, 'src/require-phd-gate.mjs'), 'utf8');
  const controlSource = fs.readFileSync(path.join(CLOS_ROOT, 'src/phd-control.mjs'), 'utf8');
  const statusSource = fs.readFileSync(path.join(CLOS_ROOT, 'src/phd-status.mjs'), 'utf8');
  for (const source of [gateSource, controlSource, statusSource]) {
    assert.match(source, /verifyPhdCampaign\s*\(/);
    assert.match(source, /canonicalJson\(recomputed\)/);
    assert.match(source, /campaignBundle/);
    assert.match(source, /phdCampaignVerificationBundleSha256/);
    assert.match(source, /verificationBundleSha256/);
  }
  assert.match(gateSource, /CLOS_PHD_CAMPAIGN_BUNDLE/);
  assert.match(gateSource, /consume\(report\)/);
  assert.match(
    gateSource,
    /CLOS_PHD_CAMPAIGN_BUNDLE',\s*\{\s*brokered:\s*true,\s*consume\(campaignBundle\)/,
  );
  assert.match(gateSource, /nested pinned immutable-object handoffs/);
  assert.match(gateSource, /campaignAccepted !== true/);
  assert.match(
    controlSource,
    /const campaignPair = readOptionalBrokered\(\s*campaignReportPath,\s*\(report\) =>/,
  );
  assert.match(
    controlSource,
    /const pair = readOptionalBrokered\(\s*campaignBundlePath,\s*\(bundle\) =>/,
  );
  assert.match(
    controlSource,
    /campaignBundlePath,\s*\(bundle\) => \{[\s\S]+verifyPhdCampaign\(\{[\s\S]+canonicalJson\(recomputed\)[\s\S]+status campaign report/,
  );
  for (const source of [gateSource, controlSource]) {
    assert.match(source, /verifyQualificationHarvestEvidence\s*\(/);
    assert.match(source, /requireArtifactManifests:\s*true/);
    assert.match(source, /requireArtifactFiles:\s*true/);
    assert.match(source, /qualificationHarvestBinding:\s*harvest[.]binding/);
    assert.match(source, /harvestedModelCallsByJob:\s*harvest[.]modelCallsByJob/);
  }
  assert.match(gateSource, /CLOS_QUALIFICATION_HARVEST_STATE/);
  assert.match(gateSource, /CLOS_QUALIFICATION_ARTIFACT_MANIFESTS/);
  assert.match(gateSource, /CLOS_QUALIFICATION_ARTIFACT_FILES/);
});

test('production proof, gate, control, and layered status consume one authenticated v3 qualification deployment', () => {
  const requestSource = fs.readFileSync(
    path.join(CLOS_ROOT, 'src/proof-runtime-attestation-request.mjs'),
    'utf8',
  );
  const gateSource = fs.readFileSync(path.join(CLOS_ROOT, 'src/require-phd-gate.mjs'), 'utf8');
  const controlSource = fs.readFileSync(path.join(CLOS_ROOT, 'src/phd-control.mjs'), 'utf8');
  const statusSource = fs.readFileSync(path.join(CLOS_ROOT, 'src/phd-status.mjs'), 'utf8');
  const boundarySource = fs.readFileSync(
    path.join(CLOS_ROOT, 'src/phd-control-boundary.mjs'),
    'utf8',
  );
  assert.match(requestSource, /verifyQualificationLaunchPlan/);
  assert.match(requestSource, /authorization:\s*'archival_harvest'/);
  assert.match(requestSource, /assertQualificationDeployment\(plan[.]deployment, program[.]deployment\)/);
  assert.match(requestSource, /assertApprovedModelExecutableAtPath/);
  assert.match(requestSource, /deployment,\s*trustPolicy/);
  for (const source of [gateSource, controlSource]) {
    assert.match(source, /verifyQualificationLaunchPlan/);
    assert.match(source, /authorization:\s*'archival_harvest'/);
    assert.match(source, /assertQualificationDeployment/);
    assert.match(
      source,
      /expectedDeployment:\s*(?:deployment|qualificationDeployment|authenticatedDeployment)/,
    );
  }
  assert.match(statusSource, /qualificationDeployment/);
  assert.match(statusSource, /assertQualificationDeployment/);
  assert.match(statusSource, /qualificationBundleDeploymentMatches/);
  assert.match(statusSource, /expectedDeployment:\s*selectedDeployment/);
  assert.match(boundarySource, /assertQualificationDeployment/);
  assert.doesNotMatch(gateSource, /CLOS_MODEL_REAL_RECEIPT|verifyTrustedExecutionEvidence/);
  assert.doesNotMatch(gateSource, /gate === 'model-real'/);
});

test('production control and layered status preserve the exact executable-bound v3 identity', () => {
  assert.throws(() => bindApprovedModelExecutable(
    runtime.deployment,
    {
      schemaVersion: 'cortex.learning_os.approved_model_executable.v1',
      path: '/invalid',
    },
    cycle7ApprovedResearchRuntimeBinding(),
  ), /mutable execution closure/);
  const deployment = cycle10QualificationDeployment(runtime.deployment);
  const control = validateProductionControlBundle({
    canonicalProgram: runtime,
    bundle: { expectedDeployment: deployment },
  });
  assert.equal(control.ok, false);
  assert.doesNotMatch(control.errors.join('; '), /production trust policy is not enabled/);
  assert.match(control.errors.join('; '), /sourceMode must be exact_git_blobs/);
  assert.match(
    control.errors.join('; '),
    /qualification deployment is not the exact executable-bound projection of committed source/,
  );
  const status = buildLayeredPhdStatus({
    program: runtime,
    qualificationDeployment: deployment,
    proofPreflight: { status: 'absent' },
  });
  assert.equal(
    status.program.deploymentDigest,
    deploymentBindingDigest(runtime.deployment),
  );
  const exactProgram = {
    ...runtime,
    deployment: sourceDeploymentBinding(deployment),
  };
  const exactStatus = buildLayeredPhdStatus({
    program: exactProgram,
    qualificationDeployment: deployment,
    proofPreflight: { status: 'absent' },
  });
  assert.equal(exactStatus.program.deploymentDigest, deploymentBindingDigest(deployment));
  const substituted = structuredClone(deployment);
  substituted.approvedModelExecutable.sha256 = '8'.repeat(64);
  const rejected = validateProductionControlBundle({
    canonicalProgram: runtime,
    bundle: { expectedDeployment: substituted },
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.errors.join('; '), /qualification deployment is invalid/);
});

test('proof runtime and replay receipts bind canonical request bytes into authority payloads', () => {
  const campaignSource = fs.readFileSync(path.join(CLOS_ROOT, 'src/phd-campaign.mjs'), 'utf8');
  const preflightSource = fs.readFileSync(path.join(CLOS_ROOT, 'src/lean-proof-preflight.mjs'), 'utf8');
  const replaySchema = JSON.parse(fs.readFileSync(
    path.join(CLOS_ROOT, 'schemas/proof-replay-receipt.schema.json'),
    'utf8',
  ));
  const runtimeSchema = JSON.parse(fs.readFileSync(
    path.join(CLOS_ROOT, 'schemas/proof-runtime-evidence.schema.json'),
    'utf8',
  ));
  assert.match(campaignSource, /requestBytesBase64/);
  assert.match(campaignSource, /requestSha256/);
  assert.match(campaignSource, /replayPayload[\s\S]*requestSha256/);
  assert.match(preflightSource, /authority payload does not authenticate the exact request/);
  assert.ok(replaySchema.required.includes('requestBytesBase64'));
  assert.ok(replaySchema.required.includes('requestSha256'));
  const requestSchema = JSON.parse(fs.readFileSync(
    path.join(CLOS_ROOT, 'schemas/proof-replay-request.schema.json'),
    'utf8',
  ));
  assert.equal(requestSchema.$id, 'cortex.learning_os.proof_replay_request.v2');
  assert.ok(requestSchema.required.includes('proofTaskSha256'));
  assert.ok(runtimeSchema.required.includes('requestBytesBase64'));
  assert.ok(runtimeSchema.required.includes('requestSha256'));
});

test('metadata shape is separate from production acquisition validation and cannot omit bank bytes', () => {
  const registry = metadataRegistry();
  assert.equal(validateAcquisitionAssessmentRegistryMetadata(registry, runtime.graph).ok, true);
  const production = validateProductionAcquisitionAssessmentRegistry({
    registry,
    assessmentBank: null,
    graph: runtime.graph,
    rubric: runtime.rubric,
    trustPolicy: runtime.trustPolicy,
    deployment: runtime.deployment,
    campaignBinding: registry[0].campaign,
  });
  assert.equal(production.ok, false);
  assert.match(production.errors.join('; '), /requires the exact signed assessment bank bytes/);

  const control = validateProductionControlBundle({
    canonicalProgram: runtime,
    command: 'campaign-verify',
    bundle: {
      expectedDeployment: runtime.deployment,
      acquisitionReceipt: { assessmentRegistry: registry },
      graph: runtime.graph,
      rubric: runtime.rubric,
      retentionPolicy: runtime.retentionPolicy,
      retentionWindows: [{}, {}],
      retentionAssessmentBanks: [{}, {}],
    },
  });
  assert.equal(control.ok, false);
  assert.match(control.errors.join('; '), /requires acquisition receipt signed bank bytes/);

  const statusOnlyControl = validateProductionControlBundle({
    canonicalProgram: runtime,
    command: 'retention-status',
    bundle: {
      expectedDeployment: runtime.deployment,
      retentionStatus: statusFor(),
    },
  });
  assert.equal(statusOnlyControl.ok, false);
  assert.match(statusOnlyControl.errors.join('; '), /requires every window, exact signed bank/);
});

test('a perfectly HMAC-signed retained summary cannot substitute for zero underlying windows', () => {
  const status = statusFor();
  assert.equal(verifyRetentionStatusRecord(status, signingSecret), true);
  const verification = verifyProductionRetentionQualification(
    retentionArguments(status, [], []),
  );
  assert.equal(verification.ok, false);
  assert.match(verification.errors.join('; '), /exactly two evidence records and two signed banks/);
});

test('final retention boundary rejects substituted banks, overlap/reuse, compressed evidence, and execution tamper', () => {
  const firstBank = bank(1);
  const secondBank = bank(2);
  const first = window(1, firstBank, {
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
  });
  const second = window(2, secondBank, {
    startedAt: '2026-01-08T00:00:01.000Z',
    completedAt: '2026-01-08T00:00:02.000Z',
  });
  let windows = [first, second];
  let status = statusFor(windows);
  assert.equal(verifyRetentionStatusRecord(status, signingSecret), true);

  const substituted = verifyProductionRetentionQualification(
    retentionArguments(status, windows, [firstBank, firstBank]),
  );
  assert.equal(substituted.ok, false);
  assert.match(substituted.errors.join('; '), /substitutes|reused a signed bank/);

  const substitutedWindow = structuredClone(second);
  substitutedWindow.items[0].itemId = 'substituted-window-item';
  const substitutedWindowResult = verifyProductionRetentionQualification(
    retentionArguments(status, [first, substitutedWindow], [firstBank, secondBank]),
  );
  assert.equal(substitutedWindowResult.ok, false);
  assert.match(substitutedWindowResult.errors.join('; '), /substitutes evidence/);

  for (const mutate of [
    (item) => { item.itemId = first.items[0].itemId; },
    (item) => { item.conceptId = first.items[0].conceptId; },
    (item) => { item.outcomeIds = structuredClone(first.items[0].outcomeIds); },
    (item) => {
      item.semanticFamilyId = first.items[0].semanticFamilyId;
      item.theoremId = first.items[0].theoremId;
    },
  ]) {
    const overlap = structuredClone(second);
    mutate(overlap.items[0]);
    windows = [first, overlap];
    status = statusFor(windows);
    assert.equal(verifyRetentionStatusRecord(status, signingSecret), true);
    const overlapping = verifyProductionRetentionQualification(
      retentionArguments(status, windows, [firstBank, secondBank]),
    );
    assert.equal(overlapping.ok, false);
    assert.match(overlapping.errors.join('; '), /overlap or reuse item, concept, outcome, or semantic family/);
  }

  const compressed = structuredClone(second);
  compressed.startedAt = '2026-01-07T23:59:59.000Z';
  windows = [first, compressed];
  status = statusFor(windows);
  assert.equal(verifyRetentionStatusRecord(status, signingSecret), true);
  const compressedResult = verifyProductionRetentionQualification(
    retentionArguments(status, windows, [firstBank, secondBank]),
  );
  assert.equal(compressedResult.ok, false);
  assert.match(compressedResult.errors.join('; '), /below 604800 seconds/);

  const tampered = structuredClone(second);
  tampered.execution.attestation.payload.executionId = 'tampered-execution';
  windows = [first, tampered];
  status = statusFor(windows);
  assert.equal(verifyRetentionStatusRecord(status, signingSecret), true);
  const tamperedResult = verifyProductionRetentionQualification(
    retentionArguments(status, windows, [firstBank, secondBank]),
  );
  assert.equal(tamperedResult.ok, false);
  assert.match(tamperedResult.errors.join('; '), /execution attestation/);
});
