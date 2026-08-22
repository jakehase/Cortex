import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AGENT_WORK_PHASE8_RELEASE_PACKET_SCHEMA,
  PHASE8_RELEASE_CANDIDATE_CLAIM,
  buildFaultReplayPacket,
  buildIndependentReleaseReviewPacket,
  buildPhase8PreflightPacket,
  buildReleaseCandidatePacket,
  buildScaleDurationPacket,
  buildWorkloadQualificationPacket,
  compileObjective,
  verifyRun,
  buildCompletionPacket,
  writePhase8ReleaseArtifacts
} from '../packages/canonical-agent-work/index.mjs';
import {
  MAILCHIMP_SOAK_DEPTH_DIMENSIONS,
  buildMailchimpGroundedSoakWorkload
} from '../apps/system-benchmark/create-agent-work-mailchimp-soak-workload.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/agent-work-v1/v0-cortex-handoff.json'), 'utf8'));

function tmpDir(label = 'phase8-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function greenWorkload(workloadClass) {
  return buildWorkloadQualificationPacket({
    workloadClass,
    repoPath: `/repos/${workloadClass}`,
    objective: `qualify ${workloadClass}`,
    status: 'green',
    productDiff: { files: [`src/${workloadClass}.mjs`] },
    provenance: { sourceDigest: sha256(`source-${workloadClass}`), artifactDigest: sha256(`artifact-${workloadClass}`) },
    independentVerification: { status: 'green' },
    negativeSpace: { checked: true },
    externalActions: { performed: false, allowed: false }
  });
}

function greenScale() {
  return buildScaleDurationPacket({
    requestedPhysicalWorkers: 12,
    observedPhysicalWorkers: Array.from({ length: 12 }, (_, i) => `worker-${i + 1}`),
    observedModelCalls: Array.from({ length: 12 }, (_, i) => ({ workerId: `worker-${i + 1}`, status: 'completed', tokens: 1000 + i })),
    canaryWorkers: 4,
    faultCampaignWorkers: 8,
    crossRepoWorkers: 12,
    soak: {
      durationMs: 6 * 60 * 60 * 1000,
      implementationRuntimeMs: 240_000,
      waves: 3,
      providerUsage: { codexCallsStarted: 12, codexCallsCompleted: 12, tokensObserved: 24_000 },
      productiveMergeCount: 12,
      changedProductFileCount: 12,
      productionQualityGate: { enabled: true, ok: true },
      objectiveTruthGate: { enabled: true, ok: true },
      targetedVerification: { status: 'green', exitCode: 0, tests: 12, fail: 0 }
    },
    providerUsage: { tokens: 50_000 }
  });
}

function greenFaultReplay() {
  return buildFaultReplayPacket({
    deterministicNoModel: { status: 'green', summary: '404/404' },
    faultFixtures: {
      controllerRestart: true,
      workerLoss: true,
      verifierFailure: true,
      staleLease: true,
      conflict: true,
      providerError: true,
      budgetExhaustion: true,
      diskPressure: true
    },
    adversarialFixtures: { status: 'green', falseGreens: 0 },
    cleanRoomReplay: { status: 'green' },
    fullTests: { status: 'green' },
    projectSpecificGates: { status: 'green' },
    sourceSync: { hashMatch: true }
  });
}

function greenReview() {
  return buildIndependentReleaseReviewPacket({
    reviewer: 'independent-release-reviewer',
    reviewed: true,
    sourceDigest: sha256('phase8-source'),
    artifactDigests: [sha256('artifact-a'), sha256('artifact-b')],
    exactClaims: [PHASE8_RELEASE_CANDIDATE_CLAIM],
    rejectedClaims: ['100 physical workers', 'universal/full parity', 'production deployment'],
    dirtySource: false
  });
}

test('corrected Phase 8 Mailchimp soak compiles a broad grounded objective instead of four-file churn', () => {
  const mailchimpRoot = path.resolve(root, '..', 'mailchimp-clone');
  const inventory = JSON.parse(fs.readFileSync(path.join(mailchimpRoot, 'docs/MAILCHIMP_STRICT_1TO1_GAP_INVENTORY_2026-05-08.json'), 'utf8'));
  const built = buildMailchimpGroundedSoakWorkload({ inventory, mailchimpRoot, maxSurfaces: 1000 });
  assert.equal(built.stats.canonicalGapCount, 26);
  assert.equal(built.stats.coverageSurfaceCount, 26);
  assert.equal(built.stats.selectedSurfaceCount, 1000);
  assert.ok(built.stats.distinctProductFileCount >= 12);
  assert.ok(built.stats.distinctTargetedTestCount >= 12);
  assert.equal(built.objectiveMatrix.status, 'red');
  assert.equal(built.objectiveMatrix.surfaces.length, 26);
  assert.equal(built.negativeSpace.count, 0);
  assert.equal(MAILCHIMP_SOAK_DEPTH_DIMENSIONS.length, 18);
  assert.equal(new Set(built.surfaces.map((surface) => surface.id)).size, built.surfaces.length);
  assert.ok(built.surfaces.every((surface) => surface.files.some((file) => !file.startsWith('tests/'))));
  assert.match(built.objectiveMatrix.truthBoundary, /not independent proof of full Mailchimp parity/i);
});

test('corrected Phase 8 Mailchimp soak fails closed on a narrow inventory', () => {
  assert.throws(() => buildMailchimpGroundedSoakWorkload({ inventory: { gaps: [] }, mailchimpRoot: root }), /grounded_inventory_too_narrow/);
});

test('Phase 8 preflight is honest blocked release-candidate evidence, not a fake green', () => {
  const packet = buildPhase8PreflightPacket({
    priorPhaseProof: { phase7OpsGreen: true, artifactDigests: [sha256('phase7')] },
    remoteBoundary: { syncHashMatch: true }
  });
  assert.equal(packet.schemaVersion, AGENT_WORK_PHASE8_RELEASE_PACKET_SCHEMA);
  assert.equal(packet.status, 'blocked');
  assert.equal(packet.releaseCandidateClaimAllowed, false);
  assert.equal(packet.operationsClaimAllowed, true);
  assert.equal(packet.matrix.status, 'blocked');
  assert.equal(packet.matrix.gateRows.find((row) => row.id === 'scale_duration_green').ok, false);
  assert.match(packet.truthBoundary, /not Phase 9 release/);
});

test('Phase 8 workload packet requires product diff or specific blocker, provenance, verifier evidence, no external actions, and clone negative-space checks', () => {
  const clone = greenWorkload('clone_parity_slice');
  assert.equal(clone.status, 'green');
  assert.equal(clone.checks.find((check) => check.id === 'negative_space_checked_for_clone_parity').ok, true);

  const blocked = buildWorkloadQualificationPacket({
    workloadClass: 'brownfield_transfer',
    status: 'blocked',
    blocker: { code: 'client_data_excluded', summary: 'No client data may enter worker context.', specific: true },
    externalActions: { performed: false, allowed: false }
  });
  assert.equal(blocked.status, 'blocked_with_specific_reason');

  const unsafe = buildWorkloadQualificationPacket({
    workloadClass: 'shared_stack_self_dogfood',
    status: 'green',
    productDiff: { files: ['src/product.mjs'] },
    provenance: { sourceDigest: sha256('s'), artifactDigest: sha256('a') },
    independentVerification: { status: 'green' },
    externalActions: { performed: true, allowed: true }
  });
  assert.equal(unsafe.status, 'blocked');
  assert.equal(unsafe.checks.find((check) => check.id === 'no_external_actions_in_worker_context').ok, false);
});

test('Phase 8 scale and duration packet refuses logical/requested scale and verifier wait time as proof', () => {
  const blocked = buildScaleDurationPacket({
    requestedPhysicalWorkers: 12,
    observedPhysicalWorkers: ['worker-1'],
    observedModelCalls: [{ workerId: 'worker-1', status: 'completed' }],
    canaryWorkers: 1,
    faultCampaignWorkers: 4,
    crossRepoWorkers: 12,
    soak: { durationMs: 6 * 60 * 60 * 1000, implementationRuntimeMs: 0, waves: 1 },
    providerUsage: { tokens: 1000 }
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.checks.find((check) => check.id === 'cross_repo_12_observed_physical_workers').ok, false);
  assert.equal(blocked.checks.find((check) => check.id === 'six_hour_real_work_soak').ok, false);

  const green = greenScale();
  assert.equal(green.status, 'green');
});

test('Phase 8 scale and duration packet rejects elapsed model churn with disabled gates and collapsed surface diversity', () => {
  const fakeSoak = buildScaleDurationPacket({
    requestedPhysicalWorkers: 12,
    observedPhysicalWorkers: Array.from({ length: 12 }, (_, i) => `worker-${i + 1}`),
    observedModelCalls: Array.from({ length: 12 }, (_, i) => ({ workerId: `worker-${i + 1}`, status: 'completed' })),
    canaryWorkers: 4,
    faultCampaignWorkers: 8,
    crossRepoWorkers: 12,
    soak: {
      durationMs: 6 * 60 * 60 * 1000,
      implementationRuntimeMs: 5 * 60 * 60 * 1000,
      waves: 90,
      providerUsage: { codexCallsStarted: 180, codexCallsCompleted: 180, tokensObserved: 9_000_000 },
      productiveMergeCount: 180,
      changedProductFileCount: 4,
      productionQualityGate: { enabled: false, ok: true },
      objectiveTruthGate: { enabled: false, ok: true },
      targetedVerification: { status: 'green', exitCode: 0, tests: 4, fail: 0 }
    },
    providerUsage: { tokens: 9_000_000 }
  });
  assert.equal(fakeSoak.status, 'blocked');
  assert.equal(fakeSoak.checks.find((check) => check.id === 'six_hour_real_work_soak').ok, true);
  assert.equal(fakeSoak.checks.find((check) => check.id === 'soak_productive_surface_diversity').ok, false);
  assert.equal(fakeSoak.checks.find((check) => check.id === 'soak_production_quality_gate_green').ok, false);
  assert.equal(fakeSoak.checks.find((check) => check.id === 'soak_objective_truth_gate_green').ok, false);
});

test('Phase 8 fault/replay packet requires every failure fixture, no false green, clean replay, tests, and sync hash', () => {
  const blocked = buildFaultReplayPacket({
    deterministicNoModel: { status: 'green' },
    faultFixtures: { controllerRestart: true },
    adversarialFixtures: { status: 'green', falseGreens: 0 },
    cleanRoomReplay: { status: 'blocked' },
    fullTests: { status: 'green' },
    projectSpecificGates: { status: 'green' },
    sourceSync: { hashMatch: false }
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.checks.find((check) => check.id === 'fault_workerLoss').ok, false);
  assert.equal(blocked.checks.find((check) => check.id === 'clean_room_replay_green').ok, false);

  assert.equal(greenFaultReplay().status, 'green');
});

test('Phase 8 release-candidate packet only goes green with workload breadth, scale/soak, replay/fault, and independent review', () => {
  const workloads = [
    greenWorkload('shared_stack_self_dogfood'),
    greenWorkload('ai_os_product_platform'),
    greenWorkload('clone_parity_slice'),
    buildWorkloadQualificationPacket({
      workloadClass: 'brownfield_transfer',
      status: 'blocked',
      blocker: { code: 'approved_brownfield_repo_required', summary: 'No approved no-client-data brownfield repo selected for this evidence packet.', specific: true },
      externalActions: { performed: false, allowed: false }
    })
  ];
  const packet = buildReleaseCandidatePacket({
    workloadPackets: workloads,
    scaleDurationPacket: greenScale(),
    faultReplayPacket: greenFaultReplay(),
    releaseReviewPacket: greenReview(),
    priorPhaseProof: { phase7OpsGreen: true }
  });
  assert.equal(packet.status, 'green');
  assert.equal(packet.releaseCandidateClaimAllowed, true);
  assert.equal(packet.allowedClaims[0], PHASE8_RELEASE_CANDIDATE_CLAIM);
  assert.equal(packet.matrix.greenWorkloadCount, 3);

  const missingScale = buildReleaseCandidatePacket({
    workloadPackets: workloads,
    scaleDurationPacket: buildScaleDurationPacket({ requestedPhysicalWorkers: 12 }),
    faultReplayPacket: greenFaultReplay(),
    releaseReviewPacket: greenReview(),
    priorPhaseProof: { phase7OpsGreen: true }
  });
  assert.equal(missingScale.status, 'blocked');
  assert.equal(missingScale.releaseCandidateClaimAllowed, false);
});

test('Phase 8 artifacts are visible through facade verify/report without inflating release claims', () => {
  const runRoot = tmpDir('phase8-facade-');
  const planned = compileObjective({ input: fixture, outputDir: runRoot, config: { executionBoundary: 'control_plane_allowed' } });
  assert.equal(planned.ok, true);
  const preflight = buildPhase8PreflightPacket({
    priorPhaseProof: { phase7OpsGreen: true, artifactDigests: [sha256('phase7')] },
    remoteBoundary: { syncHashMatch: true }
  });
  writePhase8ReleaseArtifacts(preflight, path.join(runRoot, 'release-candidate'));
  const verified = verifyRun({ runRoot });
  assert.equal(verified.data.verification.phase8ReleaseCandidateGreen, false);
  assert.equal(verified.data.verification.releaseCandidateClaimAllowed, false);
  const report = buildCompletionPacket({ runRoot });
  assert.equal(report.data.report.schemaVersion, 'clawd.agent_work.phase8_report.v1');
  assert.equal(report.data.report.phase8ReleaseCandidateStatus, 'blocked');
  assert.equal(report.data.report.releaseCandidateClaimAllowed, false);
});
