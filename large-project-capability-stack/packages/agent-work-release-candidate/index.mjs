import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const AGENT_WORK_PHASE8_RELEASE_PACKET_SCHEMA = 'clawd.agent_work.phase8_release_candidate_packet.v1';
export const AGENT_WORK_PHASE8_MATRIX_SCHEMA = 'clawd.agent_work.phase8_qualification_matrix.v1';
export const AGENT_WORK_PHASE8_WORKLOAD_PACKET_SCHEMA = 'clawd.agent_work.phase8_workload_packet.v1';
export const AGENT_WORK_PHASE8_SCALE_PACKET_SCHEMA = 'clawd.agent_work.phase8_scale_duration_packet.v1';
export const AGENT_WORK_PHASE8_FAULT_PACKET_SCHEMA = 'clawd.agent_work.phase8_fault_packet.v1';
export const AGENT_WORK_PHASE8_REVIEW_PACKET_SCHEMA = 'clawd.agent_work.phase8_review_packet.v1';

export const REQUIRED_PHASE8_WORKLOAD_CLASSES = Object.freeze([
  'shared_stack_self_dogfood',
  'ai_os_product_platform',
  'clone_parity_slice',
  'brownfield_transfer'
]);

export const REQUIRED_PHASE8_GATES = Object.freeze([
  'deterministic_no_model_suite',
  'real_worker_canary_2_4_physical_workers',
  'restart_fault_campaign_8_physical_workers',
  'productive_cross_repo_12_physical_workers',
  'six_hour_unattended_real_work_soak',
  'source_sync_clean_room_replay_review_claim_audit'
]);

const RELEASE_CANDIDATE_CLAIM = 'Agent Work v1 Phase 8 release-candidate qualification is green for the declared workload matrix, observed physical-worker evidence, six-hour real-work soak, clean-room replay, and independent release review';

function nowIso() {
  return new Date().toISOString();
}

function clean(value = '') {
  return String(value ?? '').trim();
}

function orderedList(values = []) {
  return (Array.isArray(values) ? values : [values])
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => clean(value))
    .filter(Boolean);
}

function stableList(values = []) {
  return [...new Set(orderedList(values))].sort();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => !['generatedAt', 'startedAt', 'completedAt', 'packetPath', 'matrixPath', 'releasePacketPath'].includes(key))
    .sort()
    .map((key) => [key, stableValue(value[key])]));
}

function sha256(value) {
  const payload = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(stableValue(value));
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function positiveNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0;
}

function allTrue(values = []) {
  return values.every((value) => value === true);
}

function gateStatus(ok, detail) {
  return { ok: Boolean(ok), detail: clean(detail) || (ok ? 'green' : 'blocked') };
}

export function buildWorkloadQualificationPacket({
  workloadClass,
  repoPath = null,
  objective = null,
  status = 'blocked',
  productDiff = {},
  blocker = null,
  provenance = {},
  independentVerification = {},
  negativeSpace = {},
  externalActions = {},
  generatedAt = nowIso()
} = {}) {
  const normalizedClass = clean(workloadClass);
  const requiredClass = REQUIRED_PHASE8_WORKLOAD_CLASSES.includes(normalizedClass);
  const diffFiles = stableList(productDiff.files || productDiff.modifiedFiles || []);
  const hasProductDiff = diffFiles.length > 0 || productDiff.hasProductDiff === true;
  const honestBlocker = Boolean(blocker?.code && blocker?.summary && blocker?.specific !== false);
  const verificationGreen = independentVerification.status === 'green' || independentVerification.green === true;
  const provenanceGreen = provenance.status === 'green' || provenance.green === true || Boolean(provenance.sourceDigest && provenance.artifactDigest);
  const noExternalWrites = externalActions.allowed === false || externalActions.performed === false || externalActions.performed == null;
  const negativeSpaceChecked = negativeSpace.checked === true || normalizedClass !== 'clone_parity_slice';
  const workloadGreen = status === 'green'
    && requiredClass
    && hasProductDiff
    && provenanceGreen
    && verificationGreen
    && noExternalWrites
    && negativeSpaceChecked;
  const workloadBlockedWithSpecificReason = !workloadGreen && honestBlocker && requiredClass;
  const checks = [
    { id: 'required_workload_class', ...gateStatus(requiredClass, normalizedClass || 'missing') },
    { id: 'product_diff_or_specific_blocker', ...gateStatus(hasProductDiff || workloadBlockedWithSpecificReason, hasProductDiff ? diffFiles.join(',') : (blocker?.code || 'missing')) },
    { id: 'provenance_green', ...gateStatus(provenanceGreen || workloadBlockedWithSpecificReason, provenanceGreen ? 'green' : (blocker?.code || 'missing')) },
    { id: 'independent_verification_green', ...gateStatus(verificationGreen || workloadBlockedWithSpecificReason, verificationGreen ? 'green' : (blocker?.code || 'missing')) },
    { id: 'no_external_actions_in_worker_context', ...gateStatus(noExternalWrites, externalActions.performed === true ? 'external_actions_performed' : 'none') },
    { id: 'negative_space_checked_for_clone_parity', ...gateStatus(negativeSpaceChecked || workloadBlockedWithSpecificReason, negativeSpaceChecked ? 'green' : (blocker?.code || 'missing')) }
  ];
  const packet = {
    schemaVersion: AGENT_WORK_PHASE8_WORKLOAD_PACKET_SCHEMA,
    generatedAt,
    workloadClass: normalizedClass,
    repoPath: clean(repoPath) || null,
    objective: clean(objective) || null,
    status: workloadGreen ? 'green' : (workloadBlockedWithSpecificReason ? 'blocked_with_specific_reason' : 'blocked'),
    hasProductDiff,
    diffFiles,
    blocker: blocker || null,
    provenance,
    independentVerification,
    negativeSpace,
    externalActions: { performed: externalActions.performed === true, allowed: externalActions.allowed === true },
    checks,
    truthBoundary: 'A Phase 8 workload packet proves one declared workload-class attempt. It is release-candidate evidence only when reduced with scale, duration, replay, and review packets.'
  };
  packet.digest = sha256(packet);
  return packet;
}

export function buildScaleDurationPacket({
  requestedPhysicalWorkers = 0,
  observedPhysicalWorkers = [],
  observedModelCalls = [],
  canaryWorkers = 0,
  faultCampaignWorkers = 0,
  crossRepoWorkers = 0,
  soak = {},
  providerUsage = {},
  generatedAt = nowIso()
} = {}) {
  const uniqueWorkers = stableList(observedPhysicalWorkers.map((worker) => typeof worker === 'string' ? worker : worker?.id));
  const modelCallWorkers = stableList(observedModelCalls.map((call) => call.workerId || call.worker || call.id));
  const completedCalls = observedModelCalls.filter((call) => call.status === 'completed' || call.completed === true).length;
  const requested = Number(requestedPhysicalWorkers || 0);
  const canary = Number(canaryWorkers || 0);
  const fault = Number(faultCampaignWorkers || 0);
  const crossRepo = Number(crossRepoWorkers || 0);
  const durationMs = Number(soak.durationMs || 0);
  const implementationRuntimeMs = Number(soak.implementationRuntimeMs || 0);
  const waves = Number(soak.waves || 0);
  const soakProviderCallsStarted = Number(soak.providerUsage?.codexCallsStarted || soak.providerCallsStarted || 0);
  const soakProviderCallsCompleted = Number(soak.providerUsage?.codexCallsCompleted || soak.providerCallsCompleted || 0);
  const soakTokensObserved = Number(soak.providerUsage?.tokensObserved || soak.tokensObserved || 0);
  const productiveMergeCount = Number(soak.productiveMergeCount || soak.mergedShardCount || 0);
  const changedProductFileCount = Number(soak.changedProductFileCount || 0);
  const productionQualityGate = soak.productionQualityGate || {};
  const objectiveTruthGate = soak.objectiveTruthGate || {};
  const targetedVerification = soak.targetedVerification || {};
  const targetedVerificationGreen = targetedVerification.status === 'green'
    || (Number(targetedVerification.exitCode) === 0
      && Number(targetedVerification.tests || 0) > 0
      && Number(targetedVerification.fail || 0) === 0);
  const tokenTotal = Number(providerUsage.tokens || providerUsage.totalTokens || 0);
  const checks = [
    { id: 'canary_2_4_physical_workers', ...gateStatus(canary >= 2 && canary <= 4, `${canary}`) },
    { id: 'fault_campaign_8_physical_workers', ...gateStatus(fault >= 8, `${fault}`) },
    { id: 'cross_repo_12_observed_physical_workers', ...gateStatus(requested >= 12 && crossRepo >= 12 && uniqueWorkers.length >= 12, `requested=${requested};crossRepo=${crossRepo};observed=${uniqueWorkers.length}`) },
    { id: 'model_calls_match_observed_workers', ...gateStatus(modelCallWorkers.length >= Math.min(uniqueWorkers.length, 12) && completedCalls >= Math.min(uniqueWorkers.length, 12), `calls=${completedCalls};workers=${modelCallWorkers.length}`) },
    { id: 'six_hour_real_work_soak', ...gateStatus(durationMs >= 6 * 60 * 60 * 1000 && implementationRuntimeMs > 0 && waves >= 2, `durationMs=${durationMs};implementationRuntimeMs=${implementationRuntimeMs};waves=${waves}`) },
    { id: 'soak_provider_evidence_positive', ...gateStatus(soakProviderCallsStarted > 0 && soakProviderCallsCompleted === soakProviderCallsStarted && soakTokensObserved > 0, `started=${soakProviderCallsStarted};completed=${soakProviderCallsCompleted};tokens=${soakTokensObserved}`) },
    { id: 'soak_productive_surface_diversity', ...gateStatus(productiveMergeCount >= 2 && changedProductFileCount >= 12, `productiveMerges=${productiveMergeCount};changedProductFiles=${changedProductFileCount}`) },
    { id: 'soak_production_quality_gate_green', ...gateStatus(productionQualityGate.enabled === true && productionQualityGate.ok === true, `enabled=${productionQualityGate.enabled === true};ok=${productionQualityGate.ok === true}`) },
    { id: 'soak_objective_truth_gate_green', ...gateStatus(objectiveTruthGate.enabled === true && objectiveTruthGate.ok === true, `enabled=${objectiveTruthGate.enabled === true};ok=${objectiveTruthGate.ok === true}`) },
    { id: 'soak_targeted_verification_green', ...gateStatus(targetedVerificationGreen, `status=${targetedVerification.status || 'missing'};tests=${Number(targetedVerification.tests || 0)};fail=${Number(targetedVerification.fail || 0)}`) },
    { id: 'provider_usage_positive', ...gateStatus(tokenTotal > 0, `${tokenTotal}`) }
  ];
  const packet = {
    schemaVersion: AGENT_WORK_PHASE8_SCALE_PACKET_SCHEMA,
    generatedAt,
    status: checks.every((check) => check.ok) ? 'green' : 'blocked',
    requestedPhysicalWorkers: requested,
    observedPhysicalWorkers: uniqueWorkers,
    observedModelCalls,
    canaryWorkers: canary,
    faultCampaignWorkers: fault,
    crossRepoWorkers: crossRepo,
    soak: { ...soak, durationMs, implementationRuntimeMs, waves },
    providerUsage: { ...providerUsage, tokens: tokenTotal },
    checks,
    truthBoundary: 'Physical-worker, model-call, duration, productive surface diversity, quality, objective-truth, and targeted-verification evidence must be observed. Requested/logical worker counts, repeated growth in a tiny file set, disabled gates, and verifier wait time do not count as scale or soak proof.'
  };
  packet.digest = sha256(packet);
  return packet;
}

export function buildFaultReplayPacket({
  deterministicNoModel = {},
  faultFixtures = {},
  adversarialFixtures = {},
  cleanRoomReplay = {},
  fullTests = {},
  projectSpecificGates = {},
  sourceSync = {},
  generatedAt = nowIso()
} = {}) {
  const fixtureNames = ['controllerRestart', 'workerLoss', 'verifierFailure', 'staleLease', 'conflict', 'providerError', 'budgetExhaustion', 'diskPressure'];
  const faultChecks = fixtureNames.map((name) => ({ id: `fault_${name}`, ok: faultFixtures[name] === true, detail: String(faultFixtures[name] === true) }));
  const checks = [
    { id: 'deterministic_no_model_green', ...gateStatus(deterministicNoModel.status === 'green' || deterministicNoModel.green === true, deterministicNoModel.summary || deterministicNoModel.status) },
    ...faultChecks,
    { id: 'adversarial_false_green_zero', ...gateStatus((adversarialFixtures.falseGreens || 0) === 0 && (adversarialFixtures.status === 'green' || adversarialFixtures.green === true), `falseGreens=${adversarialFixtures.falseGreens ?? 'unknown'}`) },
    { id: 'clean_room_replay_green', ...gateStatus(cleanRoomReplay.status === 'green' || cleanRoomReplay.green === true, cleanRoomReplay.summary || cleanRoomReplay.status) },
    { id: 'full_tests_green_at_release_digest', ...gateStatus(fullTests.status === 'green' || fullTests.green === true, fullTests.summary || fullTests.status) },
    { id: 'project_specific_gates_green', ...gateStatus(projectSpecificGates.status === 'green' || projectSpecificGates.green === true, projectSpecificGates.summary || projectSpecificGates.status) },
    { id: 'source_sync_hash_match', ...gateStatus(sourceSync.hashMatch === true, String(sourceSync.hashMatch === true)) }
  ];
  const packet = {
    schemaVersion: AGENT_WORK_PHASE8_FAULT_PACKET_SCHEMA,
    generatedAt,
    status: checks.every((check) => check.ok) ? 'green' : 'blocked',
    deterministicNoModel,
    faultFixtures,
    adversarialFixtures,
    cleanRoomReplay,
    fullTests,
    projectSpecificGates,
    sourceSync,
    checks,
    truthBoundary: 'Fault/replay evidence proves restart, failure, adversarial, test, and clean-room replay gates. It does not prove real-worker scale or workload breadth by itself.'
  };
  packet.digest = sha256(packet);
  return packet;
}

export function buildIndependentReleaseReviewPacket({
  reviewer = null,
  reviewed = false,
  sourceDigest = null,
  artifactDigests = [],
  exactClaims = [],
  rejectedClaims = [],
  dirtySource = false,
  generatedAt = nowIso()
} = {}) {
  const claims = stableList(exactClaims);
  const artifacts = stableList(artifactDigests);
  const rejects = stableList(rejectedClaims);
  const checks = [
    { id: 'independent_reviewer_declared', ...gateStatus(Boolean(clean(reviewer)), clean(reviewer) || 'missing') },
    { id: 'review_completed', ...gateStatus(reviewed === true, String(reviewed === true)) },
    { id: 'source_digest_recorded', ...gateStatus(Boolean(clean(sourceDigest)), clean(sourceDigest) || 'missing') },
    { id: 'artifact_digests_recorded', ...gateStatus(artifacts.length > 0, `${artifacts.length}`) },
    { id: 'exact_release_claim_declared', ...gateStatus(claims.includes(RELEASE_CANDIDATE_CLAIM), claims.join('|') || 'missing') },
    { id: 'inflated_claims_rejected', ...gateStatus(rejects.includes('100 physical workers') && rejects.includes('universal/full parity') && rejects.includes('production deployment'), rejects.join('|')) },
    { id: 'source_not_dirty', ...gateStatus(dirtySource === false, String(dirtySource)) }
  ];
  const packet = {
    schemaVersion: AGENT_WORK_PHASE8_REVIEW_PACKET_SCHEMA,
    generatedAt,
    status: checks.every((check) => check.ok) ? 'green' : 'blocked',
    reviewer: clean(reviewer) || null,
    reviewed: reviewed === true,
    sourceDigest: clean(sourceDigest) || null,
    artifactDigests: artifacts,
    exactClaims: claims,
    rejectedClaims: rejects,
    dirtySource: dirtySource === true,
    checks,
    truthBoundary: 'Independent release review is a final Phase 8 gate. It cannot be replaced by worker or supervisor self-report.'
  };
  packet.digest = sha256(packet);
  return packet;
}

export function buildQualificationMatrix({
  workloadPackets = [],
  scaleDurationPacket = null,
  faultReplayPacket = null,
  releaseReviewPacket = null,
  generatedAt = nowIso()
} = {}) {
  const workloadByClass = new Map(workloadPackets.map((packet) => [packet.workloadClass, packet]));
  const greenWorkloads = workloadPackets.filter((packet) => packet.status === 'green');
  const classRows = REQUIRED_PHASE8_WORKLOAD_CLASSES.map((workloadClass) => {
    const packet = workloadByClass.get(workloadClass) || null;
    const ok = packet?.status === 'green' || packet?.status === 'blocked_with_specific_reason';
    return {
      id: `workload_${workloadClass}`,
      workloadClass,
      status: packet?.status || 'missing',
      ok,
      proof: packet?.digest || null,
      blocker: packet?.blocker?.code || null
    };
  });
  const completedOrSpecific = classRows.filter((row) => row.ok).length;
  const requiredGreenCount = greenWorkloads.length >= 3 && completedOrSpecific === REQUIRED_PHASE8_WORKLOAD_CLASSES.length;
  const gateRows = [
    { id: 'required_workload_classes_attempted', ok: completedOrSpecific === REQUIRED_PHASE8_WORKLOAD_CLASSES.length, detail: `${completedOrSpecific}/${REQUIRED_PHASE8_WORKLOAD_CLASSES.length}` },
    { id: 'three_workload_classes_green', ok: requiredGreenCount, detail: `${greenWorkloads.length}/3` },
    { id: 'scale_duration_green', ok: scaleDurationPacket?.status === 'green', detail: scaleDurationPacket?.status || 'missing' },
    { id: 'fault_replay_green', ok: faultReplayPacket?.status === 'green', detail: faultReplayPacket?.status || 'missing' },
    { id: 'independent_release_review_green', ok: releaseReviewPacket?.status === 'green', detail: releaseReviewPacket?.status || 'missing' }
  ];
  const matrix = {
    schemaVersion: AGENT_WORK_PHASE8_MATRIX_SCHEMA,
    generatedAt,
    status: gateRows.every((row) => row.ok) ? 'all_complete' : 'blocked',
    workloadRows: classRows,
    gateRows,
    greenWorkloadCount: greenWorkloads.length,
    requiredWorkloadCount: REQUIRED_PHASE8_WORKLOAD_CLASSES.length,
    requiredGates: REQUIRED_PHASE8_GATES,
    truthBoundary: 'The Phase 8 matrix separates attempted workload breadth, green workload count, scale/duration, fault/replay, and independent review. Scoped or deterministic green cannot stand in for release-candidate green.'
  };
  matrix.digest = sha256(matrix);
  return matrix;
}

export function buildReleaseCandidatePacket({
  runId = 'agent-work-phase8-release-candidate',
  workloadPackets = [],
  scaleDurationPacket = null,
  faultReplayPacket = null,
  releaseReviewPacket = null,
  priorPhaseProof = {},
  generatedAt = nowIso()
} = {}) {
  const matrix = buildQualificationMatrix({ workloadPackets, scaleDurationPacket, faultReplayPacket, releaseReviewPacket, generatedAt });
  const checks = [
    { id: 'phase7_ops_green', ...gateStatus(priorPhaseProof.phase7OpsGreen === true, String(priorPhaseProof.phase7OpsGreen === true)) },
    { id: 'matrix_all_complete', ...gateStatus(matrix.status === 'all_complete', matrix.status) },
    { id: 'release_review_green', ...gateStatus(releaseReviewPacket?.status === 'green', releaseReviewPacket?.status || 'missing') },
    { id: 'scale_duration_green', ...gateStatus(scaleDurationPacket?.status === 'green', scaleDurationPacket?.status || 'missing') },
    { id: 'fault_replay_green', ...gateStatus(faultReplayPacket?.status === 'green', faultReplayPacket?.status || 'missing') }
  ];
  const status = checks.every((check) => check.ok) ? 'green' : 'blocked';
  const packet = {
    schemaVersion: AGENT_WORK_PHASE8_RELEASE_PACKET_SCHEMA,
    generatedAt,
    runId: clean(runId) || 'agent-work-phase8-release-candidate',
    status,
    releaseCandidateClaimAllowed: status === 'green',
    completionClaimAllowed: false,
    operationsClaimAllowed: priorPhaseProof.phase7OpsGreen === true,
    allowedClaims: status === 'green' ? [RELEASE_CANDIDATE_CLAIM] : [],
    blockedClaims: status === 'green' ? [] : [RELEASE_CANDIDATE_CLAIM],
    checks,
    matrixDigest: matrix.digest,
    workloadPacketDigests: workloadPackets.map((packet) => packet.digest),
    scaleDurationDigest: scaleDurationPacket?.digest || null,
    faultReplayDigest: faultReplayPacket?.digest || null,
    releaseReviewDigest: releaseReviewPacket?.digest || null,
    priorPhaseProof,
    matrix,
    truthBoundary: 'Phase 8 green is release-candidate qualification only. It is not Phase 9 release, public production deployment, universal autonomy, universal full parity, or 100 physical workers.'
  };
  packet.digest = sha256(packet);
  return packet;
}

export function buildPhase8PreflightPacket({
  priorPhaseProof = {},
  remoteBoundary = {},
  generatedAt = nowIso()
} = {}) {
  const workloadPackets = REQUIRED_PHASE8_WORKLOAD_CLASSES.map((workloadClass) => buildWorkloadQualificationPacket({
    workloadClass,
    status: 'blocked',
    blocker: {
      code: 'phase8_workload_not_run_yet',
      summary: `Phase 8 workload ${workloadClass} has not run yet.`,
      specific: true
    },
    externalActions: { performed: false, allowed: false },
    generatedAt
  }));
  const scaleDurationPacket = buildScaleDurationPacket({ generatedAt });
  const faultReplayPacket = buildFaultReplayPacket({ generatedAt, sourceSync: { hashMatch: remoteBoundary.syncHashMatch === true } });
  const releaseReviewPacket = buildIndependentReleaseReviewPacket({
    reviewer: null,
    reviewed: false,
    sourceDigest: priorPhaseProof.sourceDigest || null,
    artifactDigests: stableList(priorPhaseProof.artifactDigests || []),
    exactClaims: [],
    rejectedClaims: ['100 physical workers', 'universal/full parity', 'production deployment'],
    dirtySource: false,
    generatedAt
  });
  return buildReleaseCandidatePacket({
    runId: 'agent-work-phase8-preflight',
    workloadPackets,
    scaleDurationPacket,
    faultReplayPacket,
    releaseReviewPacket,
    priorPhaseProof: { ...priorPhaseProof, remoteBoundary },
    generatedAt
  });
}

export function writePhase8ReleaseArtifacts(packet, outputDir) {
  const root = path.resolve(outputDir);
  fs.mkdirSync(root, { recursive: true });
  const matrixPath = writeJson(path.join(root, 'qualification_matrix.json'), packet.matrix);
  const packetPath = writeJson(path.join(root, 'release_packet.json'), packet);
  for (const [index, workload] of (packet.matrix?.workloadRows || []).entries()) {
    if (workload.proof) continue;
    writeJson(path.join(root, `workload_${index + 1}_${workload.workloadClass}.json`), workload);
  }
  return { packetPath, matrixPath, matrix: packet.matrix };
}

export const PHASE8_RELEASE_CANDIDATE_CLAIM = RELEASE_CANDIDATE_CLAIM;
