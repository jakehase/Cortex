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
