export function parsePositiveIntegerList(value, fallback = []) {
  const rawValues = Array.isArray(value) ? value : String(value || '').split(',');
  const parsed = rawValues
    .map((entry) => Number(String(entry).trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .map((entry) => Math.floor(entry));
  const unique = Array.from(new Set(parsed)).sort((a, b) => a - b);
  if (unique.length > 0) return unique;
  return Array.from(new Set((fallback || [])
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .map((entry) => Math.floor(entry))))
    .sort((a, b) => a - b);
}

export function resolveRequestedAgentCount({ env = {}, requestedTiers = [] } = {}) {
  const explicit = Number(String(env.MAILCHIMP_REQUESTED_AGENT_COUNT || env.ORCHESTRATOR_REQUESTED_AGENT_COUNT || '').trim());
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  return Math.max(0, ...requestedTiers);
}

function isTruthyEnvDisabled(value) {
  return ['0', 'false', 'off', 'no'].includes(String(value || '').trim().toLowerCase());
}

function isFullCloneRequest({ requestedFidelity = '', env = {} } = {}) {
  return String(requestedFidelity || env.ORCHESTRATOR_REQUESTED_FIDELITY || '').trim() === 'full_clone';
}

export function normalizeFocusTargetList(value = '') {
  return [...new Set(String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.startsWith('focus.') ? entry : `focus.${entry}`))]
    .sort();
}

export function scaleProofMinimumsForAgentCount(agentCount = 0) {
  const requested = Math.max(0, Math.floor(Number(agentCount) || 0));
  if (!requested) {
    return { requestedAgentCount: 0, minimumObservedAgents: 0, minimumPeakConcurrentWorkers: 0 };
  }
  return {
    requestedAgentCount: requested,
    minimumObservedAgents: Math.min(requested, Math.max(2, Math.ceil(requested * 0.2))),
    minimumPeakConcurrentWorkers: Math.min(requested, Math.max(2, Math.ceil(requested * 0.1)))
  };
}

function highestTierAtOrBelow(tiers = [], cap = 0) {
  return [...tiers].filter((tier) => tier <= cap).at(-1) || null;
}

export function resolveAdaptiveConcurrencyTiers({
  requestedTiers = [],
  requestedAgentCount = 0,
  shardCount = 0,
  requestedFidelity = '',
  env = {}
} = {}) {
  const normalizedRequestedTiers = parsePositiveIntegerList(requestedTiers);
  const fallback = {
    mode: 'staged_ladder',
    requestedTiers: normalizedRequestedTiers,
    resolvedTiers: normalizedRequestedTiers,
    requestedAgentCount,
    shardCount: Math.max(0, Math.floor(Number(shardCount) || 0)),
    adaptiveTarget: null,
    downscaled: false,
    blocker: null,
    reason: 'adaptive concurrency not required'
  };

  if (normalizedRequestedTiers.length === 0) {
    return {
      ...fallback,
      mode: 'blocked',
      reason: 'no requested concurrency tiers were provided',
      blocker: {
        blocker: 'No requested concurrency tiers were provided for live worker execution.',
        nextAction: 'Set ORCHESTRATOR_TIERS and rerun so the worker farm cannot silently skip live concurrency.'
      }
    };
  }

  const fullClone = isFullCloneRequest({ requestedFidelity, env });
  const adaptiveEnabled = !isTruthyEnvDisabled(env.ORCHESTRATOR_ADAPTIVE_CONCURRENCY);
  const forceStaged = String(env.ORCHESTRATOR_FORCE_STAGED_LADDER || '').trim() === '1';
  const highConcurrencyRequested = requestedAgentCount >= 80 || Math.max(...normalizedRequestedTiers) >= 80;
  if (!fullClone || !adaptiveEnabled || forceStaged || !highConcurrencyRequested) {
    return {
      ...fallback,
      reason: forceStaged
        ? 'staged ladder explicitly forced'
        : !adaptiveEnabled
          ? 'adaptive concurrency disabled'
          : !fullClone
            ? 'not a full-clone request'
            : 'high concurrency was not requested'
    };
  }

  const availableShards = Math.max(0, Math.floor(Number(shardCount) || 0));
  const requestedCap = requestedAgentCount > 0 ? requestedAgentCount : Math.max(...normalizedRequestedTiers);
  const runnableCap = Math.min(requestedCap, availableShards || requestedCap);
  const adaptiveTarget = highestTierAtOrBelow(normalizedRequestedTiers, runnableCap)
    || normalizedRequestedTiers[0];
  const resolvedTiers = normalizedRequestedTiers.filter((tier) => tier === adaptiveTarget);
  const downscaled = adaptiveTarget < requestedCap;

  const base = {
    mode: 'adaptive_concurrency',
    requestedTiers: normalizedRequestedTiers,
    resolvedTiers,
    requestedAgentCount,
    shardCount: availableShards,
    adaptiveTarget,
    downscaled,
    blocker: null,
    reason: downscaled
      ? `requested ${requestedCap} agents but only ${availableShards} runnable shards supported tier ${adaptiveTarget}`
      : `large backlog supports requested tier ${adaptiveTarget}`
  };

  if (availableShards >= Math.min(requestedCap, 32) && adaptiveTarget < 32) {
    return {
      ...base,
      mode: 'blocked',
      blocker: {
        blocker: `High-concurrency full-clone run requested ${requestedCap} agents, but requested tiers ${normalizedRequestedTiers.join(',')} resolved only to ${adaptiveTarget} despite ${availableShards} runnable shards.`,
        nextAction: 'Include scalable tiers such as 32,64,100 in ORCHESTRATOR_TIERS, or explicitly set ORCHESTRATOR_FORCE_STAGED_LADDER=1 to allow a low-tier warmup.'
      },
      reason: 'requested tiers cannot satisfy high-concurrency backlog without a silent low-tier fallback'
    };
  }

  return base;
}

export function resolveScaleProofPreflight({
  requestedTiers = [],
  requestedAgentCount = 0,
  shardPlan = {},
  requestedFidelity = '',
  resourcePreflight = null,
  env = {}
} = {}) {
  const normalizedRequestedTiers = parsePositiveIntegerList(requestedTiers);
  const requested = Math.max(0, Math.floor(Number(requestedAgentCount) || 0));
  const highScaleRequested = requested >= 80 || Math.max(0, ...normalizedRequestedTiers) >= 80;
  const fullClone = isFullCloneRequest({ requestedFidelity, env });
  const disabled = isTruthyEnvDisabled(env.MAILCHIMP_SCALE_PREFLIGHT);
  const scaleProofRequired = fullClone && highScaleRequested && !disabled;
  const summary = shardPlan?.summary || {};
  const shardCount = Math.max(0, Math.floor(Number(summary.shardCount ?? shardPlan?.shards?.length ?? 0) || 0));
  const initialReadyCount = Math.max(0, Math.floor(Number(summary.initialReadyCount ?? shardPlan?.frontier?.initialReadyCount ?? shardCount) || 0));
  const laneCount = Math.max(0, Math.floor(Number(summary.laneCount ?? Object.keys(shardPlan?.byLane || {}).length) || 0));
  const domainCount = Math.max(0, Math.floor(Number(summary.domainCount ?? Object.keys(shardPlan?.byDomain || {}).length) || 0));
  const targetFocusIds = normalizeFocusTargetList(env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS || '');
  const targetedRepairMode = targetFocusIds.length > 0;
  const allowTargetedScaleProof = String(env.MAILCHIMP_ALLOW_TARGETED_SCALE_PROOF || env.MAILCHIMP_ALLOW_TARGETED_FINAL_BOSS_SCALE_PROOF || '').trim() === '1';
  const minimums = scaleProofMinimumsForAgentCount(requested || Math.max(0, ...normalizedRequestedTiers));
  const minimumShardCount = minimums.minimumObservedAgents;
  const minimumInitialReadyCount = minimums.minimumPeakConcurrentWorkers;
  const minimumDistinctLanes = Math.min(minimumInitialReadyCount, 3);
  const failures = [];

  if (scaleProofRequired) {
    if (targetedRepairMode && !allowTargetedScaleProof) {
      failures.push({
        reason: 'targeted_focus_set_active_for_high_scale_full_clone',
        targetFocusIds,
        nextAction: 'Clear MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS before a broad final-boss scale proof, or set MAILCHIMP_ALLOW_TARGETED_SCALE_PROOF=1 only for an explicitly labeled repair run.'
      });
    }
    if (shardCount < minimumShardCount) {
      failures.push({ reason: 'insufficient_total_shards_for_scale_proof', shardCount, minimumShardCount });
    }
    if (initialReadyCount < minimumInitialReadyCount) {
      failures.push({ reason: 'insufficient_initial_ready_shards_for_concurrency', initialReadyCount, minimumInitialReadyCount });
    }
    if (laneCount < minimumDistinctLanes) {
      failures.push({ reason: 'insufficient_distinct_lanes_for_balanced_scale', laneCount, minimumDistinctLanes });
    }
    if (resourcePreflight?.ok === false) {
      failures.push({
        reason: 'resource_preflight_failed',
        resourcePreflightStatus: resourcePreflight.status || null,
        resourceFailures: Array.isArray(resourcePreflight.failures) ? resourcePreflight.failures : [],
        nextAction: resourcePreflight.blocker?.nextAction || 'Free/resize execution-plane resources or lower the declared concurrency tier before rerunning.'
      });
    }
  }

  return {
    schemaVersion: 'mailchimp.scale_proof_preflight.v1',
    generatedAt: new Date().toISOString(),
    ok: failures.length === 0,
    status: failures.length === 0 ? 'scale_preflight_ready' : 'scale_preflight_blocked',
    scaleProofRequired,
    disabled,
    requestedFidelity: requestedFidelity || env.ORCHESTRATOR_REQUESTED_FIDELITY || null,
    requestedAgentCount: requested,
    requestedTiers: normalizedRequestedTiers,
    highScaleRequested,
    shardCount,
    initialReadyCount,
    laneCount,
    domainCount,
    targetFocusIds,
    targetedRepairMode,
    allowTargetedScaleProof,
    resourcePreflight,
    minimums: {
      ...minimums,
      minimumShardCount,
      minimumInitialReadyCount,
      minimumDistinctLanes
    },
    failures,
    blocker: failures.length ? {
      blocker: 'High-scale full-clone launch preflight failed before VM worker execution.',
      nextAction: failures[0]?.nextAction || 'Repair shard breadth, ready-work depth, lane diversity, or targeted-mode configuration before rerunning the final-boss scale proof.',
      failures
    } : null
  };
}
