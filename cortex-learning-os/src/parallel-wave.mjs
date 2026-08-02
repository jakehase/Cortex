import crypto from 'node:crypto';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { policyDigest, validateAdaptivePlanRuntime } from './adaptive-policy.mjs';
import { buildAdaptiveSessionPlan, verifyAdaptivePlanSignature } from './adaptive-session.mjs';
import {
  verifyAdaptiveArtifacts,
  verifyAdaptiveFixtureArtifacts,
} from './adaptive-verifier.mjs';
import { prerequisiteClosure, validateCurriculumGraph } from './curriculum-planner.mjs';
import { generateExercise, replayGeneratedExercise } from './generated-exercises.mjs';
import { sha256Text } from './hash.mjs';
import { validateIndependentAssessmentBank } from './phd-assessment.mjs';
import {
  applyMasteryDeltasAtomically,
  validateMasteryState,
  verifyMasteryState,
} from './mastery-state.mjs';

export const PARALLEL_WAVE_SCHEMA = 'cortex.learning_os.parallel_acquisition_wave.v1';
export const DEFAULT_WAVE_CONCURRENCY = 4;
export const MIN_WAVE_CONCURRENCY = 1;
export const MAX_WAVE_CONCURRENCY = 8;
const WAVE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COMMIT_ID = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ACTION_KINDS = new Set(['acquisition', 'learning_retry', 'prerequisite_repair', 'same_concept_correction']);
const ACTION_ROLES = new Set(['acquisition', 'correction']);

function signatureKeyId(secret) {
  return sha256Text(secret).slice(0, 16);
}

function unsignedWave(wave) {
  const { controlPlaneSignature: _signature, ...payload } = wave;
  return payload;
}

function signWave(payload, secret) {
  return {
    ...payload,
    controlPlaneSignature: {
      algorithm: 'hmac-sha256',
      keyId: signatureKeyId(secret),
      digest: crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex'),
    },
  };
}

function verifyWaveSignature(wave, secret) {
  const signature = wave?.controlPlaneSignature;
  if (signature?.algorithm !== 'hmac-sha256'
      || signature.keyId !== signatureKeyId(secret)
      || !DIGEST.test(String(signature.digest || ''))) return false;
  const expected = crypto.createHmac('sha256', secret).update(canonicalJson(unsignedWave(wave))).digest();
  const actual = Buffer.from(signature.digest, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function gateMet(record, policy) {
  return record?.state === 'acquired'
    && record.consecutivePasses >= policy.prerequisiteGate.minimumConsecutivePasses;
}

function confidence(record) {
  return record.attempts ? record.passes / record.attempts + Math.min(record.consecutivePasses, 4) / 100 : 0;
}

function stableRank(seed, conceptId) {
  return sha256Text(`${seed}:${conceptId}`);
}

function actionFootprint(action) {
  return [...new Set([action.conceptId, action.blockedConceptId].filter(Boolean))].sort();
}

function candidateActions({ graph, state, policy, seed }) {
  const validation = validateCurriculumGraph(graph);
  const byId = new Map(graph.concepts.map((concept) => [concept.conceptId, concept]));
  const topologicalIndex = validation.topologicalIndex;
  const ready = (conceptId) => byId.get(conceptId).prerequisites.every((id) => gateMet(state.concepts[id], policy));
  const actions = [];

  for (const repair of state.pendingRepairs) {
    const failedConceptId = repair.failedConceptId;
    if (!byId.has(failedConceptId)) continue;
    const unmetReady = prerequisiteClosure(graph, failedConceptId)
      .filter((conceptId) => !gateMet(state.concepts[conceptId], policy) && ready(conceptId))
      .sort((left, right) => topologicalIndex[left] - topologicalIndex[right] || left.localeCompare(right))[0];
    if (unmetReady && state.concepts[unmetReady].consecutiveFailures < policy.budgets.maxAttemptsPerConcept) {
      actions.push({
        priority: 0,
        action: {
          kind: 'prerequisite_repair',
          conceptId: unmetReady,
          role: 'correction',
          reasonCode: 'prerequisite_ready_repair',
          evidenceRefs: [`mastery:pendingRepairs/${failedConceptId}`, `graph:concepts/${unmetReady}`],
          blockedConceptId: failedConceptId,
        },
      });
    } else if (!unmetReady && ready(failedConceptId)
        && state.concepts[failedConceptId].consecutiveFailures < policy.budgets.maxAttemptsPerConcept) {
      actions.push({
        priority: 0,
        action: {
          kind: 'same_concept_correction',
          conceptId: failedConceptId,
          role: 'correction',
          reasonCode: 'prerequisites_sufficient_same_concept_retry',
          evidenceRefs: [`mastery:pendingRepairs/${failedConceptId}`],
        },
      });
    }
  }

  for (const conceptId of validation.topologicalOrder) {
    const record = state.concepts[conceptId];
    if (!ready(conceptId)) continue;
    if (record.state === 'unassessed') {
      actions.push({
        priority: 1,
        action: {
          kind: 'acquisition',
          conceptId,
          role: 'acquisition',
          reasonCode: 'eligible_unassessed_concept',
          evidenceRefs: byId.get(conceptId).prerequisites.map((id) => `mastery:concepts/${id}`),
        },
      });
    } else if (['learning', 'blocked_prerequisite'].includes(record.state)
        && record.consecutiveFailures < policy.budgets.maxAttemptsPerConcept) {
      actions.push({
        priority: 2,
        confidence: confidence(record),
        action: {
          kind: 'learning_retry',
          conceptId,
          role: 'acquisition',
          reasonCode: 'lowest_confidence_eligible_learning',
          evidenceRefs: [`mastery:concepts/${conceptId}`],
        },
      });
    }
  }

  return actions.sort((left, right) => left.priority - right.priority
    || (left.confidence ?? 0) - (right.confidence ?? 0)
    || topologicalIndex[left.action.conceptId] - topologicalIndex[right.action.conceptId]
    || left.action.conceptId.localeCompare(right.action.conceptId)
    || stableRank(seed, left.action.conceptId).localeCompare(stableRank(seed, right.action.conceptId)));
}

export function selectParallelWaveActions({
  graph,
  state,
  policy,
  seed = 'parallel-acquisition',
  concurrency = DEFAULT_WAVE_CONCURRENCY,
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < MIN_WAVE_CONCURRENCY || concurrency > MAX_WAVE_CONCURRENCY) {
    throw new Error(`parallel acquisition concurrency must be ${MIN_WAVE_CONCURRENCY}..${MAX_WAVE_CONCURRENCY}`);
  }
  const validation = validateCurriculumGraph(graph);
  if (!validation.ok) throw new Error(`invalid parallel curriculum graph: ${validation.errors.join('; ')}`);
  const stateValidation = validateMasteryState(state, { graph, policy });
  if (!stateValidation.ok) throw new Error(`invalid parallel acquisition state: ${stateValidation.errors.join('; ')}`);
  if (policy.reviewSelection?.enabled !== false || policy.reviewSelection?.scheduleNewReviews !== false) {
    throw new Error('parallel waves require acquisition-only policy');
  }
  if (policy.curriculumId !== graph.curriculumId || policy.capsuleId !== graph.capsuleId) {
    throw new Error('parallel graph and policy scope mismatch');
  }
  const selected = [];
  const occupied = new Set();
  for (const row of candidateActions({ graph, state, policy, seed })) {
    const footprint = actionFootprint(row.action);
    if (footprint.some((conceptId) => occupied.has(conceptId))) continue;
    if (!ACTION_KINDS.has(row.action.kind) || !ACTION_ROLES.has(row.action.role)) {
      throw new Error('parallel planner selected forbidden work');
    }
    selected.push(structuredClone(row.action));
    footprint.forEach((conceptId) => occupied.add(conceptId));
    if (selected.length === concurrency) break;
  }
  return selected;
}

function frozenExercise(item) {
  replayGeneratedExercise(item);
  const itemBytes = canonicalJson(item);
  const oracleBytes = canonicalJson({
    family: item.generation.family,
    parameters: item.generation.parameters,
    checker: item.checker,
  });
  return {
    itemBytes,
    itemSha256: sha256Text(itemBytes),
    oracleBytes,
    oracleSha256: sha256Text(oracleBytes),
  };
}

function generatedRecords(action, childSeed, policy) {
  const rows = [
    ['observed', generateExercise({
      conceptId: action.conceptId,
      seed: `${childSeed}:observed`,
      role: action.role,
    })],
    ['correction', generateExercise({
      conceptId: action.conceptId,
      seed: `${childSeed}:correction`,
      role: 'correction',
    })],
    ...Array.from({ length: policy.pairedEvaluation.pairCount }, (_, index) => {
      const pairId = `candidate-pair-${String(index + 1).padStart(2, '0')}`;
      return [`paired/${pairId}`, generateExercise({
        conceptId: action.conceptId,
        seed: `${childSeed}:paired:${pairId}`,
        role: 'promotion-transfer',
      })];
    }),
  ];
  return Object.fromEntries(rows.map(([name, item]) => [name, frozenExercise(item)]));
}

export function buildParallelWave({
  waveId,
  graph,
  policy,
  capsule,
  state,
  sourceCommit,
  sourceTree,
  seed = 'parallel-acquisition',
  concurrency = DEFAULT_WAVE_CONCURRENCY,
  signingSecret,
  runtimeOverride = null,
  assessmentBank = null,
  assessmentTrustPolicy = null,
  assessmentDeployment = null,
  assessmentRubric = null,
  now = new Date().toISOString(),
  expiresAt = new Date(Date.parse(now) + 4 * 60 * 60 * 1000).toISOString(),
} = {}) {
  if (!WAVE_ID.test(String(waveId || ''))) throw new Error('invalid parallel waveId');
  if (!COMMIT_ID.test(String(sourceCommit || '')) || !COMMIT_ID.test(String(sourceTree || ''))) {
    throw new Error('parallel wave requires exact source commit and tree');
  }
  if (typeof signingSecret !== 'string' || signingSecret.length < 32) throw new Error('parallel wave requires a control-plane secret');
  if (capsule?.capsuleId !== graph?.capsuleId) throw new Error('parallel capsule and graph scope mismatch');
  const stateVerification = verifyMasteryState(state, signingSecret, { graph, policy });
  if (!stateVerification.ok) throw new Error(`parallel wave source state verification failed: ${stateVerification.errors.join('; ')}`);
  const generatedAtMs = Date.parse(String(now || ''));
  const expiresAtMs = Date.parse(String(expiresAt || ''));
  if (!Number.isFinite(generatedAtMs) || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= generatedAtMs || expiresAtMs - generatedAtMs > 24 * 60 * 60 * 1000) {
    throw new Error('parallel wave expiry must be after generation and within 24 hours');
  }
  const runtime = runtimeOverride === null ? policy.modelRuntime : runtimeOverride;
  if (!validateAdaptivePlanRuntime(policy, runtime)) throw new Error('parallel wave runtime is weaker than policy');
  if (assessmentBank !== null) {
    const assessmentValidation = validateIndependentAssessmentBank(assessmentBank, {
      graph,
      rubric: assessmentRubric,
      trustPolicy: assessmentTrustPolicy,
      deployment: assessmentDeployment,
      campaignBinding: assessmentBank?.bindings?.campaign,
    });
    if (!assessmentValidation.ok) {
      throw new Error(`invalid production acquisition assessment bank: ${assessmentValidation.errors.join('; ')}`);
    }
    if (assessmentBank.purpose !== 'acquisition') {
      throw new Error('parallel acquisition requires an acquisition-purpose independent bank');
    }
  }
  const actions = selectParallelWaveActions({ graph, state, policy, seed, concurrency });
  const selected = actions.map((action, mergeIndex) => {
    const runId = `${waveId}.c${String(mergeIndex + 1).padStart(2, '0')}`;
    const childSeed = `${seed}:${String(mergeIndex + 1).padStart(2, '0')}:${action.conceptId}`;
    const relevantRepairRecords = state.pendingRepairs
      .filter((repair) => repair.failedConceptId === (action.blockedConceptId || action.conceptId));
    const sessionPlan = buildAdaptiveSessionPlan({
      runId,
      graph,
      policy,
      mastery: state,
      sourceCommit,
      seed: childSeed,
      signingSecret,
      runtimeOverride: runtime,
      frozenAction: action,
      assessmentBank,
      assessmentTrustPolicy,
      deployment: assessmentDeployment,
      assessmentRubric,
      now,
    });
    return {
      mergeIndex,
      action,
      footprintConceptIds: actionFootprint(action),
      sourceConceptRecord: structuredClone(state.concepts[action.conceptId]),
      relevantRepairRecords: structuredClone(relevantRepairRecords),
      generated: generatedRecords(action, childSeed, policy),
      child: {
        runId,
        seed: childSeed,
        modelRuntime: structuredClone(runtime),
        constraints: {
          executionPlane: 'hetzner',
          detached: true,
          sandbox: 'read-only',
          toolsAllowed: false,
          hmacSecretAvailable: false,
        },
        artifactRelativeRoot: `children/${runId}`,
        sessionPlan,
      },
    };
  });
  const graphBytes = canonicalJson(graph);
  const policyBytes = canonicalJson(policy);
  const capsuleBytes = canonicalJson(capsule);
  const stateBytes = canonicalJson(state);
  const payload = {
    schemaVersion: PARALLEL_WAVE_SCHEMA,
    waveId,
    generatedAt: now,
    expiresAt,
    concurrency,
    source: { commit: sourceCommit, tree: sourceTree },
    identities: {
      graph: { curriculumId: graph.curriculumId, sha256: sha256Text(graphBytes) },
      policy: { policyId: policy.policyId, sha256: sha256Text(policyBytes) },
      capsule: { capsuleId: capsule.capsuleId, sha256: sha256Text(capsuleBytes) },
      assessmentBank: assessmentBank === null ? null : {
        bankId: assessmentBank.bankId,
        bankDigest: assessmentBank.bankDigest,
        sha256: sha256Text(canonicalJson(assessmentBank)),
      },
      state: {
        schemaVersion: state.schemaVersion,
        baseRevision: state.revision,
        sha256: sha256Text(stateBytes),
        signatureDigest: state.signature?.digest,
      },
    },
    baseAppliedRuns: {
      runIds: structuredClone(state.appliedRunIds),
      receipts: structuredClone(state.appliedRunReceipts),
    },
    selected,
    mergeOrder: selected.map((row) => row.child.runId),
    reviewSelectionEnabled: false,
    truthBoundary: 'This signed wave freezes disjoint acquisition or correction evidence collection. A verified pass records acquired-once evidence only; no review, retention claim, broad qualification, or model-weight change is authorized.',
  };
  return signWave(payload, signingSecret);
}

function verifyFrozenGenerated(selected, policy) {
  const expected = generatedRecords(selected.action, selected.child.seed, policy);
  if (canonicalJson(expected) !== canonicalJson(selected.generated)) {
    throw new Error(`parallel wave generated item/oracle mismatch: ${selected.child.runId}`);
  }
  for (const record of Object.values(selected.generated)) {
    if (record.itemSha256 !== sha256Text(record.itemBytes)
        || record.oracleSha256 !== sha256Text(record.oracleBytes)) {
      throw new Error(`parallel wave generated byte digest mismatch: ${selected.child.runId}`);
    }
    replayGeneratedExercise(JSON.parse(record.itemBytes));
  }
}

export function verifyParallelWave({
  wave,
  graph,
  policy,
  capsule,
  signingSecret,
  expectedSourceCommit,
  expectedSourceTree,
  assessmentBank = null,
  now = new Date().toISOString(),
  allowExpired = false,
} = {}) {
  if (wave?.schemaVersion !== PARALLEL_WAVE_SCHEMA || !verifyWaveSignature(wave, signingSecret)) {
    throw new Error('parallel wave signature mismatch');
  }
  if (!Number.isInteger(wave.concurrency)
      || wave.concurrency < MIN_WAVE_CONCURRENCY || wave.concurrency > MAX_WAVE_CONCURRENCY
      || !Array.isArray(wave.selected) || wave.selected.length > wave.concurrency
      || !Array.isArray(wave.mergeOrder)) throw new Error('invalid parallel wave structure');
  const generatedAtMs = Date.parse(String(wave.generatedAt || ''));
  const expiresAtMs = Date.parse(String(wave.expiresAt || ''));
  if (!Number.isFinite(generatedAtMs) || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= generatedAtMs || expiresAtMs - generatedAtMs > 24 * 60 * 60 * 1000) {
    throw new Error('invalid parallel wave time window');
  }
  if (wave.source?.commit !== expectedSourceCommit || wave.source?.tree !== expectedSourceTree) {
    throw new Error('parallel wave source identity mismatch');
  }
  if (!allowExpired && Date.parse(now) > Date.parse(wave.expiresAt)) throw new Error('parallel wave expired');
  if (wave.identities?.graph?.sha256 !== sha256Text(canonicalJson(graph))
      || wave.identities?.policy?.sha256 !== policyDigest(policy)
      || wave.identities?.capsule?.sha256 !== sha256Text(canonicalJson(capsule))
      || wave.identities.graph.curriculumId !== graph.curriculumId
      || wave.identities.policy.policyId !== policy.policyId
      || wave.identities.capsule.capsuleId !== capsule.capsuleId
      || !Number.isSafeInteger(wave.identities?.state?.baseRevision)
      || !DIGEST.test(String(wave.identities?.state?.sha256 || ''))
      || !DIGEST.test(String(wave.identities?.state?.signatureDigest || ''))
      || !Array.isArray(wave.baseAppliedRuns?.runIds)
      || !Array.isArray(wave.baseAppliedRuns?.receipts)
      || wave.baseAppliedRuns.runIds.length !== wave.baseAppliedRuns.receipts.length) {
    throw new Error('parallel wave graph, policy, or capsule identity mismatch');
  }
  const expectedAssessmentIdentity = assessmentBank === null ? null : {
    bankId: assessmentBank.bankId,
    bankDigest: assessmentBank.bankDigest,
    sha256: sha256Text(canonicalJson(assessmentBank)),
  };
  if (canonicalJson(wave.identities.assessmentBank) !== canonicalJson(expectedAssessmentIdentity)) {
    throw new Error('parallel wave independent assessment bank identity mismatch');
  }
  const seenFootprints = new Set();
  const conceptIds = new Set(graph.concepts.map((concept) => concept.conceptId));
  for (const [mergeIndex, selected] of wave.selected.entries()) {
    if (selected.mergeIndex !== mergeIndex
        || !ACTION_KINDS.has(selected.action?.kind) || !ACTION_ROLES.has(selected.action?.role)
        || canonicalJson(selected.footprintConceptIds) !== canonicalJson(actionFootprint(selected.action))
        || !conceptIds.has(selected.action.conceptId)
        || !selected.sourceConceptRecord || !Array.isArray(selected.relevantRepairRecords)
        || selected.child?.constraints?.executionPlane !== 'hetzner'
        || selected.child.constraints.detached !== true
        || selected.child.constraints.sandbox !== 'read-only'
        || selected.child.constraints.toolsAllowed !== false
        || selected.child.constraints.hmacSecretAvailable !== false
        || canonicalJson(selected.child.modelRuntime) !== canonicalJson(selected.child.sessionPlan?.modelRuntime)
        || selected.child.sessionPlan?.runId !== selected.child.runId
        || selected.child.sessionPlan?.seed !== selected.child.seed
        || selected.child.sessionPlan?.sourceCommit !== wave.source.commit
        || selected.child.sessionPlan?.masteryRevision !== wave.identities.state.baseRevision
        || selected.child.sessionPlan?.masterySnapshotDigest !== wave.identities.state.sha256
        || canonicalJson(selected.child.sessionPlan?.action) !== canonicalJson(selected.action)
        || !verifyAdaptivePlanSignature(selected.child.sessionPlan, signingSecret)) {
      throw new Error('invalid signed parallel child plan');
    }
    if (selected.footprintConceptIds.some((conceptId) => seenFootprints.has(conceptId))) {
      throw new Error('parallel wave concept or repair-target overlap');
    }
    selected.footprintConceptIds.forEach((conceptId) => seenFootprints.add(conceptId));
    verifyFrozenGenerated(selected, policy);
  }
  if (canonicalJson(wave.mergeOrder) !== canonicalJson(wave.selected.map((row) => row.child.runId))) {
    throw new Error('parallel wave merge order mismatch');
  }
  return true;
}

function assertFrozenStateIsSafe(wave, currentState) {
  if (currentState.revision < wave.identities.state.baseRevision) throw new Error('parallel wave state revision moved backwards');
  if (canonicalJson(currentState.appliedRunIds.slice(0, wave.baseAppliedRuns.runIds.length))
      !== canonicalJson(wave.baseAppliedRuns.runIds)
      || canonicalJson(currentState.appliedRunReceipts.slice(0, wave.baseAppliedRuns.receipts.length))
      !== canonicalJson(wave.baseAppliedRuns.receipts)) {
    throw new Error('parallel wave applied-run receipt prefix changed');
  }
  if (currentState.revision === wave.identities.state.baseRevision
      && sha256Text(canonicalJson(currentState)) !== wave.identities.state.sha256) {
    throw new Error('parallel wave base state digest mismatch');
  }
  for (const selected of wave.selected) {
    if (canonicalJson(currentState.concepts[selected.action.conceptId])
        !== canonicalJson(selected.sourceConceptRecord)) {
      throw new Error(`parallel wave selected concept record is stale: ${selected.action.conceptId}`);
    }
    const repairTarget = selected.action.blockedConceptId || selected.action.conceptId;
    const currentRepairs = currentState.pendingRepairs.filter((row) => row.failedConceptId === repairTarget);
    if (canonicalJson(currentRepairs) !== canonicalJson(selected.relevantRepairRecords)) {
      throw new Error(`parallel wave repair record is stale: ${repairTarget}`);
    }
  }
}

function verifyAndApplyParallelWaveInternal({
  wave,
  artifactRoots,
  graph,
  policy,
  capsule,
  currentState,
  signingSecret,
  expectedSourceCommit,
  expectedSourceTree,
  fixedTemplates = [],
  allowTestFixtures = false,
  executionTrustPolicy = null,
  assessmentBank = null,
  assessmentDeployment = null,
  assessmentRubric = null,
  now = new Date().toISOString(),
} = {}) {
  verifyParallelWave({
    wave,
    graph,
    policy,
    capsule,
    signingSecret,
    expectedSourceCommit,
    expectedSourceTree,
    assessmentBank,
    now,
    allowExpired: true,
  });
  const stateVerification = verifyMasteryState(currentState, signingSecret, { graph, policy });
  if (!stateVerification.ok) throw new Error(`parallel wave current state verification failed: ${stateVerification.errors.join('; ')}`);
  if (!(artifactRoots instanceof Map)) throw new Error('parallel wave artifact roots must be keyed by exact runId');
  const replays = [];
  for (const selected of wave.selected) {
    const artifactRoot = artifactRoots.get(selected.child.runId);
    if (typeof artifactRoot !== 'string' || !artifactRoot) throw new Error(`parallel wave artifact root missing: ${selected.child.runId}`);
    const verifier = allowTestFixtures ? verifyAdaptiveFixtureArtifacts : verifyAdaptiveArtifacts;
    const replay = verifier({
      artifactRoot,
      graph,
      policy,
      capsule,
      currentMastery: currentState,
      expectedSourceCommit,
      fixedTemplates,
      executionTrustPolicy,
      assessmentBank,
      assessmentDeployment,
      assessmentRubric,
      planSecret: signingSecret,
      expectedPlan: selected.child.sessionPlan,
      allowFrozenWaveSelection: true,
    });
    if (!replay.recomputedDelta) {
      throw new Error(`parallel wave child produced no safely applicable learning evidence: ${selected.child.runId}`);
    }
    const completedAtMs = Date.parse(replay.recomputedDelta.completedAt);
    if (completedAtMs > Date.parse(wave.expiresAt)
        || completedAtMs < Date.parse(wave.generatedAt) - 300_000) {
      throw new Error(`parallel wave child evidence is outside the signed expiry window: ${selected.child.runId}`);
    }
    replays.push({ selected, replay });
  }
  const applied = replays.map(({ selected, replay }) => {
    const receipt = currentState.appliedRunReceipts.find((row) => row.runId === selected.child.runId);
    if (!receipt) return false;
    if (receipt.artifactManifestDigest !== replay.artifactManifestDigest) {
      throw new Error(`parallel wave runId/artifact substitution: ${selected.child.runId}`);
    }
    return true;
  });
  if (applied.some(Boolean) && !applied.every(Boolean)) throw new Error('parallel wave has a partial prior application');
  if (applied.every(Boolean) && applied.length > 0) {
    return { state: currentState, applied: false, alreadyApplied: true, replays };
  }
  if (Date.parse(now) > Date.parse(wave.expiresAt)) {
    throw new Error('parallel wave expired before complete exact idempotent application');
  }
  assertFrozenStateIsSafe(wave, currentState);
  const artifactManifestDigests = new Map(replays.map(({ selected, replay }) => [
    selected.child.runId,
    replay.artifactManifestDigest,
  ]));
  const state = applyMasteryDeltasAtomically({
    state: currentState,
    deltas: replays.map(({ replay }) => replay.recomputedDelta),
    graph,
    policy,
    artifactManifestDigests,
    expectedBaseRevision: wave.identities.state.baseRevision,
    expectedConceptIds: replays.map(({ selected }) => selected.action.conceptId),
  });
  return { state, applied: true, alreadyApplied: false, replays };
}

export function verifyAndApplyParallelWave(options = {}) {
  if (Object.hasOwn(options, 'allowTestFixtures')) {
    throw new Error('production parallel-wave verifier has no fixture acceptance mode');
  }
  return verifyAndApplyParallelWaveInternal({ ...options, allowTestFixtures: false });
}

export function verifyAndApplyParallelWaveFixture(options = {}) {
  const { allowTestFixtures: _fixtureMarker, ...fixtureOptions } = options;
  return verifyAndApplyParallelWaveInternal({ ...fixtureOptions, allowTestFixtures: true });
}
