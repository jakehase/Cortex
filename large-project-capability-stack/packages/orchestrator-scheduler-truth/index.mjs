function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || '').trim())
    .filter(Boolean))].sort();
}

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}

function parseTime(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeArea(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\*\*$/g, '')
    .replace(/\*$/g, '')
    .replace(/\/$/, '')
    .trim();
}

function overlapsArea(left, right) {
  const a = normalizeArea(left);
  const b = normalizeArea(right);
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function median(values = []) {
  const sorted = values.map(Number).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : round((sorted[middle - 1] + sorted[middle]) / 2, 2);
}

function percentile(values = [], p = 0.95) {
  const sorted = values.map(Number).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function shardListFromPlan(shardPlan = {}) {
  return Array.isArray(shardPlan?.shards) ? shardPlan.shards : [];
}

function fileAreasForShard(shard = {}) {
  return stableList([...(shard.fileAreas || []), ...(shard.allowedFiles || [])]);
}

function laneOfShard(shard = {}) {
  return String(shard.lane || shard.domain || 'unclassified');
}

function estimateVerifierCost(shard = {}) {
  const verifierCount = Array.isArray(shard.requiredVerifiers) ? shard.requiredVerifiers.length : 0;
  const acceptanceCount = Array.isArray(shard.acceptanceChecks) ? shard.acceptanceChecks.length : 0;
  return verifierCount * 2 + acceptanceCount;
}

function collisionRisk(shard = {}, allShards = []) {
  const fileAreas = fileAreasForShard(shard);
  if (!fileAreas.length) return 'unknown';
  const overlapCount = allShards.filter((other) => other.id !== shard.id && fileAreas.some((area) => fileAreasForShard(other).some((otherArea) => overlapsArea(area, otherArea)))).length;
  if (overlapCount >= 5) return 'high';
  if (overlapCount >= 1 || fileAreas.length > 6) return 'medium';
  return 'low';
}

export function buildSchedulerModel({ shardPlan = {}, surfaceMatrix = { surfaces: [] } } = {}) {
  const shards = shardListFromPlan(shardPlan);
  const laneCounts = {};
  const fileOwnership = {};
  const dependencyReadiness = {};
  const verifierCost = {};
  const collisionRisks = {};
  for (const shard of shards) {
    const lane = laneOfShard(shard);
    laneCounts[lane] = (laneCounts[lane] || 0) + 1;
    for (const area of fileAreasForShard(shard)) {
      fileOwnership[area] ||= [];
      fileOwnership[area].push(shard.id);
    }
    dependencyReadiness[shard.id] = {
      dependencyShardIds: stableList(shard.dependencyShardIds || []),
      dependencyCount: stableList(shard.dependencyShardIds || []).length,
      initiallyReady: stableList(shard.dependencyShardIds || []).length === 0
    };
    verifierCost[shard.id] = estimateVerifierCost(shard);
    collisionRisks[shard.id] = collisionRisk(shard, shards);
  }
  const hotFileAreas = Object.entries(fileOwnership)
    .filter(([, owners]) => owners.length > 1)
    .map(([fileArea, owners]) => ({ fileArea, ownerCount: owners.length, shardIds: stableList(owners) }))
    .sort((a, b) => b.ownerCount - a.ownerCount || a.fileArea.localeCompare(b.fileArea));
  return {
    schemaVersion: 'claw.scheduler_model.v1',
    generatedAt: new Date().toISOString(),
    shardCount: shards.length,
    surfaceCount: Array.isArray(surfaceMatrix?.surfaces) ? surfaceMatrix.surfaces.length : 0,
    laneCounts,
    laneCount: Object.keys(laneCounts).length,
    fileOwnership,
    hotFileAreas,
    dependencyReadiness,
    verifierCost,
    collisionRisks,
    collisionRiskCounts: Object.values(collisionRisks).reduce((acc, risk) => {
      acc[risk] = (acc[risk] || 0) + 1;
      return acc;
    }, {}),
    estimatedVerifierCostTotal: Object.values(verifierCost).reduce((sum, value) => sum + Number(value || 0), 0)
  };
}

function eventTimeSort(events = []) {
  return [...events]
    .map((event, index) => ({ index, atMs: parseTime(event.at), ...event }))
    .filter((event) => event.atMs != null)
    .sort((a, b) => a.atMs - b.atMs || a.index - b.index);
}

function isSpawn(event) {
  return event.type === 'live_worker_spawned' || event.type === 'live_worker_respawned';
}

function isTerminal(event) {
  return event.type === 'live_worker_exit'
    || event.type === 'live_worker_result_terminal_rejection'
    || event.type === 'late_result_ignored';
}

function productiveMergedPatches(patchQueue = {}) {
  return (patchQueue.merged || []).filter((patch) => {
    if (patch.canonicalLandingRecord) return patch.canonicalLandingRecord.eligible === true;
    if (patch.admissionAudit?.canonicalLandingRecord) return patch.admissionAudit.canonicalLandingRecord.eligible === true;
    return Array.isArray(patch.filePaths) && patch.filePaths.length > 0;
  }).length;
}

export function deriveObservedConcurrencyTruth({ workerEvents = [], shardPlan = {}, patchQueue = {}, requestedAgentCount = null, productiveMergedPatchCount = null } = {}) {
  const events = eventTimeSort(workerEvents);
  const shardById = new Map(shardListFromPlan(shardPlan).map((shard) => [shard.id, shard]));
  const active = new Map();
  const uniqueAgents = new Set();
  const laneActive = {};
  const lanePeak = {};
  const spawnTimes = [];
  const assignmentGapsMs = [];
  const idleGapsMs = [];
  const workerDurationsMs = [];
  let activeCount = 0;
  let peakConcurrentWorkers = 0;
  let activeWorkerMs = 0;
  let lastEventAt = events[0]?.atMs || null;
  let lastSpawnAt = null;
  let idleStartedAt = null;

  for (const event of events) {
    if (lastEventAt != null && event.atMs >= lastEventAt) {
      activeWorkerMs += activeCount * (event.atMs - lastEventAt);
    }
    if (isSpawn(event)) {
      if (event.agentId) uniqueAgents.add(String(event.agentId));
      if (lastSpawnAt != null) assignmentGapsMs.push(event.atMs - lastSpawnAt);
      if (idleStartedAt != null) {
        const gap = event.atMs - idleStartedAt;
        if (gap > 0) idleGapsMs.push(gap);
        idleStartedAt = null;
      }
      const key = event.leaseId || `${event.agentId || 'agent'}:${event.shardId || 'shard'}:${event.atMs}`;
      const shard = shardById.get(event.shardId) || {};
      const lane = laneOfShard(shard);
      active.set(key, { atMs: event.atMs, agentId: event.agentId || null, shardId: event.shardId || null, lane });
      laneActive[lane] = (laneActive[lane] || 0) + 1;
      lanePeak[lane] = Math.max(lanePeak[lane] || 0, laneActive[lane]);
      activeCount += 1;
      peakConcurrentWorkers = Math.max(peakConcurrentWorkers, activeCount);
      spawnTimes.push(event.atMs);
      lastSpawnAt = event.atMs;
    } else if (isTerminal(event)) {
      const key = event.leaseId || null;
      let activeEntry = key ? active.get(key) : null;
      let activeKey = key;
      if (!activeEntry && event.agentId && event.shardId) {
        const found = [...active.entries()].find(([, entry]) => entry.agentId === event.agentId && entry.shardId === event.shardId);
        if (found) [activeKey, activeEntry] = found;
      }
      if (activeEntry) {
        workerDurationsMs.push(Math.max(0, event.atMs - activeEntry.atMs));
        active.delete(activeKey);
        laneActive[activeEntry.lane] = Math.max(0, (laneActive[activeEntry.lane] || 0) - 1);
        activeCount = Math.max(0, activeCount - 1);
        if (activeCount === 0) idleStartedAt = event.atMs;
      }
    }
    lastEventAt = event.atMs;
  }

  const shardCount = shardListFromPlan(shardPlan).length || (patchQueue.merged || []).length + (patchQueue.rejected || []).length;
  const productiveCount = productiveMergedPatchCount !== null && productiveMergedPatchCount !== undefined && Number.isFinite(Number(productiveMergedPatchCount))
    ? Number(productiveMergedPatchCount)
    : productiveMergedPatches(patchQueue);
  const requested = Number.isFinite(Number(requestedAgentCount)) && Number(requestedAgentCount) > 0 ? Number(requestedAgentCount) : null;
  const requiredConcurrentWorkers = requested == null ? null : Math.min(requested, Math.max(shardCount, 1));
  const wallClockMs = events.length ? Math.max(0, events.at(-1).atMs - events[0].atMs) : 0;
  return {
    schemaVersion: 'claw.observed_concurrency_truth.v1',
    generatedAt: new Date().toISOString(),
    requestedAgentCount: requested,
    requiredConcurrentWorkers,
    shardCount,
    eventCount: events.length,
    uniqueAgentCount: uniqueAgents.size,
    uniqueAgentIds: [...uniqueAgents].sort(),
    peakConcurrentWorkers,
    activeWorkerMs,
    activeWorkerMinutes: round(activeWorkerMs / 60000, 3),
    wallClockMs,
    wallClockMinutes: round(wallClockMs / 60000, 3),
    medianWorkerRuntimeMs: median(workerDurationsMs),
    p95WorkerRuntimeMs: percentile(workerDurationsMs, 0.95),
    assignmentGapCount: assignmentGapsMs.length,
    medianTimeToNextAssignmentMs: median(assignmentGapsMs),
    p95TimeToNextAssignmentMs: percentile(assignmentGapsMs, 0.95),
    idleGapCount: idleGapsMs.length,
    totalIdleMs: idleGapsMs.reduce((sum, value) => sum + value, 0),
    longestIdleGapMs: idleGapsMs.length ? Math.max(...idleGapsMs) : 0,
    lanePeakConcurrency: lanePeak,
    productiveMergedPatchCount: productiveCount,
    mergedPatchCount: (patchQueue.merged || []).length,
    rejectedPatchCount: (patchQueue.rejected || []).length
  };
}

export function evaluateScaleCredit({ concurrencyTruth, requestedAgentCount = concurrencyTruth?.requestedAgentCount, productiveMergedPatchCount = concurrencyTruth?.productiveMergedPatchCount, shardCount = concurrencyTruth?.shardCount, requireProductiveMerges = true, minProductiveMergeRatio = 1 } = {}) {
  const requested = Number.isFinite(Number(requestedAgentCount)) && Number(requestedAgentCount) > 0 ? Number(requestedAgentCount) : null;
  const shards = Math.max(0, Number(shardCount || 0));
  const requiredConcurrentWorkers = requested == null ? null : Math.min(requested, Math.max(shards, 1));
  const requiredProductiveMerges = requireProductiveMerges
    ? Math.max(1, Math.ceil(Math.min(shards || Number(productiveMergedPatchCount || 0), requiredConcurrentWorkers || shards || 1) * Number(minProductiveMergeRatio || 1)))
    : 0;
  const failures = [];
  if (requested != null && shards < requested) failures.push({ reason: 'insufficient_schedulable_shards', requestedAgentCount: requested, shardCount: shards });
  if (requiredConcurrentWorkers != null && Number(concurrencyTruth?.peakConcurrentWorkers || 0) < requiredConcurrentWorkers) failures.push({ reason: 'insufficient_peak_concurrency', requiredConcurrentWorkers, peakConcurrentWorkers: concurrencyTruth?.peakConcurrentWorkers || 0 });
  if (requiredConcurrentWorkers != null && Number(concurrencyTruth?.uniqueAgentCount || 0) < requiredConcurrentWorkers) failures.push({ reason: 'insufficient_unique_agents', requiredConcurrentWorkers, uniqueAgentCount: concurrencyTruth?.uniqueAgentCount || 0 });
  if (requireProductiveMerges && Number(productiveMergedPatchCount || 0) < requiredProductiveMerges) failures.push({ reason: 'insufficient_productive_merges', requiredProductiveMerges, productiveMergedPatchCount: Number(productiveMergedPatchCount || 0) });
  if (Number(concurrencyTruth?.activeWorkerMs || 0) <= 0) failures.push({ reason: 'missing_active_worker_time', activeWorkerMs: concurrencyTruth?.activeWorkerMs || 0 });
  return {
    schemaVersion: 'claw.scale_credit_evaluation.v1',
    generatedAt: new Date().toISOString(),
    eligible: failures.length === 0,
    status: failures.length === 0 ? 'scale_credit_ready' : 'scale_credit_blocked',
    requestedAgentCount: requested,
    shardCount: shards,
    requiredConcurrentWorkers,
    requireProductiveMerges,
    requiredProductiveMerges,
    productiveMergedPatchCount: Number(productiveMergedPatchCount || 0),
    peakConcurrentWorkers: concurrencyTruth?.peakConcurrentWorkers || 0,
    uniqueAgentCount: concurrencyTruth?.uniqueAgentCount || 0,
    activeWorkerMinutes: concurrencyTruth?.activeWorkerMinutes || 0,
    failures
  };
}

export function buildSchedulerTruthReport(input = {}) {
  const schedulerModel = input.schedulerModel || buildSchedulerModel(input);
  const concurrencyTruth = input.concurrencyTruth || deriveObservedConcurrencyTruth(input);
  const scaleCredit = input.scaleCredit || evaluateScaleCredit({
    concurrencyTruth,
    requestedAgentCount: input.requestedAgentCount,
    productiveMergedPatchCount: input.productiveMergedPatchCount,
    shardCount: input.shardCount,
    requireProductiveMerges: input.requireProductiveMerges !== false
  });
  return {
    schemaVersion: 'claw.scheduler_truth_report.v1',
    generatedAt: new Date().toISOString(),
    schedulerModel,
    concurrencyTruth,
    scaleCredit,
    summary: {
      schedulerShardCount: schedulerModel.shardCount,
      laneCount: schedulerModel.laneCount,
      hotFileAreaCount: schedulerModel.hotFileAreas.length,
      peakConcurrentWorkers: concurrencyTruth.peakConcurrentWorkers,
      uniqueAgentCount: concurrencyTruth.uniqueAgentCount,
      activeWorkerMinutes: concurrencyTruth.activeWorkerMinutes,
      idleGapCount: concurrencyTruth.idleGapCount,
      productiveMergedPatchCount: scaleCredit.productiveMergedPatchCount,
      scaleCreditEligible: scaleCredit.eligible
    }
  };
}
