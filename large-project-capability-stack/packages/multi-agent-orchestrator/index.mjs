import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function iso(value = Date.now()) {
  return new Date(value).toISOString();
}

function stableList(list) {
  return [...new Set((list || []).filter((entry) => entry !== undefined && entry !== null && `${entry}`.trim() !== '').map((entry) => `${entry}`.trim()))].sort();
}

function chunk(list, size) {
  if (!list.length) return [[]];
  const width = Math.max(1, size || list.length);
  const out = [];
  for (let index = 0; index < list.length; index += width) out.push(list.slice(index, index + width));
  return out;
}

function normalizeArea(area) {
  return `${area || ''}`
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

function normalizeAssignmentContract(contract = {}, fallback = {}) {
  const targetFiles = stableList(contract.targetFiles || fallback.targetFiles || []);
  const targetModules = stableList(contract.targetModules || fallback.targetModules || []);
  const verifierRequirements = stableList(contract.verifierRequirements || fallback.verifierRequirements || []);
  const successPredicate = stableList(contract.successPredicate || fallback.successPredicate || []);
  return {
    artifactKind: `${contract.artifactKind || fallback.artifactKind || 'verification_evidence'}`.trim() || 'verification_evidence',
    targetFiles,
    targetModules,
    verifierRequirements,
    successPredicate
  };
}

function validateGroundedAssignmentContract(contract = {}) {
  const failures = [];
  if ((contract.targetFiles || []).length === 0 && (contract.targetModules || []).length === 0) failures.push('missing_targets');
  if ((contract.verifierRequirements || []).length === 0) failures.push('missing_verifier_requirements');
  if ((contract.successPredicate || []).length === 0) failures.push('missing_success_predicate');
  return {
    ok: failures.length === 0,
    failures
  };
}

function buildSurfaceIndex(surfaceMatrix) {
  const index = new Map();
  for (const surface of surfaceMatrix?.surfaces || []) {
    for (const issueId of surface.issueIds || []) {
      const existing = index.get(issueId) || [];
      existing.push(surface.id);
      index.set(issueId, stableList(existing));
    }
  }
  return index;
}

export function summarizeShardFrontier(shards = []) {
  const pending = new Set(shards.map((shard) => shard.id));
  const completed = new Set();
  const layers = [];

  while (pending.size > 0) {
    const ready = shards
      .filter((shard) => pending.has(shard.id) && (shard.dependencyShardIds || []).every((dependencyShardId) => completed.has(dependencyShardId)))
      .map((shard) => shard.id)
      .sort();

    if (!ready.length) {
      layers.push({ index: layers.length + 1, shardIds: [...pending].sort(), count: pending.size, blockedByCycle: true });
      break;
    }

    layers.push({ index: layers.length + 1, shardIds: ready, count: ready.length, blockedByCycle: false });
    for (const shardId of ready) {
      pending.delete(shardId);
      completed.add(shardId);
    }
  }

  const counts = layers.map((layer) => layer.count);
  return {
    initialReadyCount: counts[0] || 0,
    maxReadyCount: counts.length ? Math.max(...counts) : 0,
    layerCount: layers.length,
    blockedByCycle: layers.some((layer) => layer.blockedByCycle),
    layers
  };
}

function normalizeWorkUnit(unit, surfaceIndex = new Map()) {
  if (!unit?.id) throw new Error('workUnit.id is required');
  const fileAreas = stableList(unit.fileAreas || unit.fileArea || []);
  const allowedFiles = stableList(unit.allowedFiles || unit.files || []);
  const acceptanceChecks = stableList(unit.acceptanceChecks || unit.acceptanceCriteria || ['complete local acceptance checks']);
  const deps = stableList(unit.deps || unit.dependencies || []);
  const requiredVerifiers = stableList(unit.requiredVerifiers || ['tests']);
  const assignmentContract = normalizeAssignmentContract(unit.assignmentContract || unit.metadata?.assignmentContract || {}, {
    artifactKind: unit.metadata?.artifactKind || 'verification_evidence',
    targetFiles: allowedFiles,
    targetModules: fileAreas,
    verifierRequirements: requiredVerifiers,
    successPredicate: acceptanceChecks
  });
  return {
    id: unit.id,
    title: unit.title || unit.id,
    goal: unit.goal || unit.title || unit.id,
    lane: unit.lane || 'default',
    domain: unit.domain || unit.lane || 'default',
    fileAreas,
    allowedFiles,
    deps,
    inputRefs: stableList(unit.inputRefs || []),
    inputs: unit.inputs || {},
    requiredVerifiers,
    acceptanceChecks,
    effortSteps: Math.max(1, Number(unit.effortSteps || 1)),
    stallAttempts: stableList(unit.stallAttempts || []).map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry) && entry > 0),
    ownership: {
      lane: unit.lane || 'default',
      domain: unit.domain || unit.lane || 'default',
      fileAreas
    },
    surfaceIds: stableList(unit.surfaceIds || surfaceIndex.get(unit.id) || []),
    metadata: {
      ...(unit.metadata || {}),
      assignmentContract
    }
  };
}

export function buildShardPlan({ workGraph, surfaceMatrix = { surfaces: [] }, options = {} }) {
  const maxFileAreasPerShard = Math.max(1, Number(options.maxFileAreasPerShard || 2));
  const maxFilesPerShard = Math.max(1, Number(options.maxFilesPerShard || 4));
  const maxAcceptanceChecksPerShard = Math.max(1, Number(options.maxAcceptanceChecksPerShard || 4));
  const surfaceIndex = buildSurfaceIndex(surfaceMatrix);
  const workUnits = (workGraph?.workUnits || []).map((unit) => normalizeWorkUnit(unit, surfaceIndex));
  const unitShardIds = new Map();

  for (const unit of workUnits) {
    const sliceCount = Math.max(
      chunk(unit.fileAreas, maxFileAreasPerShard).length,
      chunk(unit.allowedFiles, maxFilesPerShard).length,
      chunk(unit.acceptanceChecks, maxAcceptanceChecksPerShard).length
    );
    unitShardIds.set(unit.id, Array.from({ length: sliceCount }, (_, index) => sliceCount === 1 ? unit.id : `${unit.id}#${index + 1}`));
  }

  const shards = [];
  for (const unit of workUnits) {
    const shardIds = unitShardIds.get(unit.id);
    const fileAreaChunks = chunk(unit.fileAreas, maxFileAreasPerShard);
    const allowedFileChunks = chunk(unit.allowedFiles, maxFilesPerShard);
    const acceptanceChunks = chunk(unit.acceptanceChecks, maxAcceptanceChecksPerShard);
    for (let index = 0; index < shardIds.length; index += 1) {
      const shardId = shardIds[index];
      const dependencyShardIds = index > 0
        ? [shardIds[index - 1]]
        : stableList(unit.deps.map((depId) => unitShardIds.get(depId)?.at(-1)).filter(Boolean));
      const shardFileAreas = fileAreaChunks[index] || [];
      const shardAllowedFiles = allowedFileChunks[index] || [];
      const shardAcceptanceChecks = acceptanceChunks[index] && acceptanceChunks[index].length ? acceptanceChunks[index] : unit.acceptanceChecks;
      shards.push({
        id: shardId,
        rootWorkUnitId: unit.id,
        title: shardIds.length === 1 ? unit.title : `${unit.title} (${index + 1}/${shardIds.length})`,
        goal: shardIds.length === 1 ? unit.goal : `${unit.goal} [slice ${index + 1}/${shardIds.length}]`,
        splitPart: shardIds.length === 1 ? null : { index: index + 1, total: shardIds.length },
        lane: unit.lane,
        domain: unit.domain,
        surfaceIds: unit.surfaceIds,
        fileAreas: shardFileAreas,
        allowedFiles: shardAllowedFiles,
        dependencyShardIds,
        inputRefs: unit.inputRefs,
        inputs: unit.inputs,
        acceptanceChecks: shardAcceptanceChecks,
        requiredVerifiers: unit.requiredVerifiers,
        effortSteps: unit.effortSteps,
        stallAttempts: unit.stallAttempts,
        ownership: unit.ownership,
        metadata: {
          ...unit.metadata,
          assignmentContract: normalizeAssignmentContract({
            ...(unit.metadata?.assignmentContract || {}),
            targetFiles: shardAllowedFiles,
            targetModules: shardFileAreas.length ? shardFileAreas : shardAllowedFiles,
            verifierRequirements: unit.requiredVerifiers,
            successPredicate: shardAcceptanceChecks
          }, {
            artifactKind: unit.metadata?.assignmentContract?.artifactKind || unit.metadata?.artifactKind || 'verification_evidence'
          })
        }
      });
    }
  }

  const byLane = {};
  const byDomain = {};
  for (const shard of shards) {
    byLane[shard.lane] ||= [];
    byLane[shard.lane].push(shard.id);
    byDomain[shard.domain] ||= [];
    byDomain[shard.domain].push(shard.id);
  }

  const frontier = summarizeShardFrontier(shards);

  return {
    generatedAt: new Date().toISOString(),
    targetPath: workGraph?.targetPath || null,
    summary: {
      workUnitCount: workUnits.length,
      shardCount: shards.length,
      laneCount: Object.keys(byLane).length,
      domainCount: Object.keys(byDomain).length,
      maxDependenciesPerShard: Math.max(0, ...shards.map((shard) => shard.dependencyShardIds.length)),
      initialReadyCount: frontier.initialReadyCount,
      maxReadyCount: frontier.maxReadyCount,
      readyLayerCount: frontier.layerCount
    },
    byLane,
    byDomain,
    workUnits,
    shards,
    frontier,
    rootShardMap: Object.fromEntries([...unitShardIds.entries()])
  };
}

export function createLeaseState(input = {}) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    defaultTtlMs: Math.max(1000, Number(input.defaultTtlMs || 5 * 60 * 1000)),
    sequence: 1,
    taskAttempts: {},
    tasks: {},
    fileAreas: {},
    history: []
  };
}

function isLeaseActive(lease, now = Date.now()) {
  return Boolean(lease && lease.status === 'active' && new Date(lease.expiresAt).getTime() > now);
}

function activeLeases(state, now = Date.now()) {
  return Object.values(state.tasks || {}).filter((lease) => isLeaseActive(lease, now));
}

export function detectOwnershipConflicts(state, request, now = Date.now()) {
  const taskId = request.taskId;
  const fileAreas = stableList(request.fileAreas || []);
  const conflicts = [];
  for (const lease of activeLeases(state, now)) {
    if (lease.taskId === taskId) {
      if (request.agentId && lease.agentId !== request.agentId) {
        conflicts.push({ type: 'task_owned', taskId, leaseId: lease.leaseId, ownerAgentId: lease.agentId });
      }
      continue;
    }
    const overlapping = fileAreas.filter((area) => lease.fileAreas.some((ownedArea) => overlapsArea(area, ownedArea)));
    if (overlapping.length) {
      conflicts.push({ type: 'file_area_owned', taskId, ownerTaskId: lease.taskId, ownerAgentId: lease.agentId, fileAreas: overlapping, leaseId: lease.leaseId });
    }
  }
  return conflicts;
}

export function acquireLease(state, request, now = Date.now()) {
  const next = clone(state);
  const fileAreas = stableList(request.fileAreas || []);
  const ttlMs = Math.max(1000, Number(request.ttlMs || next.defaultTtlMs));
  const conflicts = detectOwnershipConflicts(next, { ...request, fileAreas }, now);
  if (conflicts.length) return { ok: false, state: next, conflicts };

  const existing = next.tasks[request.taskId];
  if (existing && isLeaseActive(existing, now) && existing.agentId === request.agentId) {
    existing.expiresAt = iso(now + ttlMs);
    existing.ttlMs = ttlMs;
    next.history.push({ at: iso(now), type: 'lease_renewed_via_acquire', leaseId: existing.leaseId, taskId: existing.taskId, agentId: existing.agentId });
    return { ok: true, state: next, lease: clone(existing) };
  }

  const attempt = (next.taskAttempts[request.taskId] || 0) + 1;
  next.taskAttempts[request.taskId] = attempt;
  const leaseId = request.leaseId || `lease-${next.sequence++}`;
  const lease = {
    leaseId,
    taskId: request.taskId,
    agentId: request.agentId,
    fileAreas,
    claimedAt: iso(now),
    expiresAt: iso(now + ttlMs),
    ttlMs,
    status: 'active',
    attempt,
    metadata: request.metadata || {}
  };
  next.tasks[request.taskId] = lease;
  for (const area of fileAreas) next.fileAreas[area] = leaseId;
  next.history.push({ at: iso(now), type: 'lease_acquired', leaseId, taskId: request.taskId, agentId: request.agentId, fileAreas, attempt });
  return { ok: true, state: next, lease: clone(lease) };
}

export function renewLease(state, request, now = Date.now()) {
  const next = clone(state);
  const lease = Object.values(next.tasks).find((entry) => entry.leaseId === request.leaseId || entry.taskId === request.taskId);
  if (!lease) return { ok: false, state: next, error: 'lease_not_found' };
  if (!isLeaseActive(lease, now)) return { ok: false, state: next, error: 'lease_not_active' };
  if (request.agentId && lease.agentId !== request.agentId) return { ok: false, state: next, error: 'lease_owned_by_other_agent' };
  const ttlMs = Math.max(1000, Number(request.ttlMs || lease.ttlMs || next.defaultTtlMs));
  lease.expiresAt = iso(now + ttlMs);
  lease.ttlMs = ttlMs;
  next.history.push({ at: iso(now), type: 'lease_renewed', leaseId: lease.leaseId, taskId: lease.taskId, agentId: lease.agentId, ttlMs });
  return { ok: true, state: next, lease: clone(lease) };
}

export function releaseLease(state, request, now = Date.now()) {
  const next = clone(state);
  const lease = Object.values(next.tasks).find((entry) => entry.leaseId === request.leaseId || entry.taskId === request.taskId);
  if (!lease) return { ok: false, state: next, error: 'lease_not_found' };
  if (request.agentId && lease.agentId !== request.agentId) return { ok: false, state: next, error: 'lease_owned_by_other_agent' };
  lease.status = request.reason === 'completed' ? 'completed' : request.reason === 'expired' ? 'expired' : 'released';
  lease.releasedAt = iso(now);
  lease.releaseReason = request.reason || 'released';
  for (const [area, leaseId] of Object.entries(next.fileAreas)) {
    if (leaseId === lease.leaseId) delete next.fileAreas[area];
  }
  next.history.push({ at: iso(now), type: 'lease_released', leaseId: lease.leaseId, taskId: lease.taskId, agentId: lease.agentId, reason: lease.releaseReason });
  return { ok: true, state: next, lease: clone(lease) };
}

export function detectStaleLeases(state, { now = Date.now() } = {}) {
  return Object.values(state.tasks || {})
    .filter((lease) => lease?.status === 'active' && new Date(lease.expiresAt).getTime() <= now)
    .sort((left, right) => left.taskId.localeCompare(right.taskId));
}

export function recoverStaleLeases(state, { now = Date.now(), agentIds = [] } = {}) {
  let next = clone(state);
  const staleLeases = detectStaleLeases(next, { now });
  const recoveryActions = [];
  const orderedAgents = stableList(agentIds);
  let rotationIndex = 0;

  for (const stale of staleLeases) {
    const released = releaseLease(next, { leaseId: stale.leaseId, agentId: stale.agentId, reason: 'expired' }, now);
    next = released.state;
    const recoveryAgent = orderedAgents[rotationIndex % (orderedAgents.length || 1)] || stale.agentId;
    rotationIndex += 1;
    const reacquired = acquireLease(next, {
      taskId: stale.taskId,
      agentId: recoveryAgent,
      fileAreas: stale.fileAreas,
      ttlMs: stale.ttlMs,
      metadata: { recoveredFrom: stale.leaseId }
    }, now);
    next = reacquired.state;
    recoveryActions.push({
      taskId: stale.taskId,
      previousAgentId: stale.agentId,
      nextAgentId: reacquired.lease?.agentId || recoveryAgent,
      previousLeaseId: stale.leaseId,
      nextLeaseId: reacquired.lease?.leaseId || null,
      fileAreas: stale.fileAreas
    });
  }

  return {
    state: next,
    staleLeases,
    recoveryActions,
    recoveredCount: recoveryActions.length
  };
}

function detectFailedShards({ shardPlan, patchQueue, leaseState, maxAttemptsPerTask }) {
  if (!Number.isFinite(maxAttemptsPerTask) || maxAttemptsPerTask <= 0) return [];
  const merged = new Set((patchQueue?.merged || []).map((artifact) => artifact.shardId));
  return shardPlan.shards
    .filter((shard) => !merged.has(shard.id) && Number(leaseState?.taskAttempts?.[shard.id] || 0) >= maxAttemptsPerTask)
    .map((shard) => ({
      shardId: shard.id,
      attempts: Number(leaseState?.taskAttempts?.[shard.id] || 0),
      maxAttemptsPerTask,
      dependencies: shard.dependencyShardIds || [],
      fileAreas: shard.fileAreas || []
    }));
}

export function createArtifactBus(input = {}) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    rootPath: input.rootPath || null,
    sequence: 1,
    registry: [],
    events: []
  };
}

export function publishArtifact(bus, input) {
  const next = bus || createArtifactBus();
  const artifactId = input.id || `artifact-${next.sequence++}`;
  const artifact = {
    artifactId,
    type: input.type,
    shardId: input.shardId || null,
    taskId: input.taskId || input.shardId || null,
    producer: input.producer || null,
    filePath: input.filePath || null,
    metadata: input.metadata || {},
    createdAt: input.createdAt || new Date().toISOString()
  };
  next.registry.push(artifact);
  next.events.push({ id: `event-${next.sequence++}`, at: artifact.createdAt, type: 'artifact_published', artifactId, artifactType: artifact.type, shardId: artifact.shardId, taskId: artifact.taskId });
  return { bus: next, artifact };
}

export function recordArtifactEvent(bus, event) {
  const next = bus || createArtifactBus();
  next.events.push({ id: `event-${next.sequence++}`, at: event.at || new Date().toISOString(), ...event });
  return next;
}

export function findArtifacts(bus, filter = {}) {
  return bus.registry.filter((artifact) => {
    if (filter.type && artifact.type !== filter.type) return false;
    if (filter.shardId && artifact.shardId !== filter.shardId) return false;
    if (filter.taskId && artifact.taskId !== filter.taskId) return false;
    return true;
  });
}

export function summarizeArtifactBus(bus) {
  const byType = {};
  const byShard = {};
  for (const artifact of bus.registry) {
    byType[artifact.type] ||= 0;
    byType[artifact.type] += 1;
    if (artifact.shardId) {
      byShard[artifact.shardId] ||= 0;
      byShard[artifact.shardId] += 1;
    }
  }
  return {
    artifactCount: bus.registry.length,
    eventCount: bus.events.length,
    byType,
    byShard
  };
}

export function compileContextPack({ contract, shard, shardPlan, surfaceMatrix = { surfaces: [] }, artifactBus = createArtifactBus(), globalInputs = {} }) {
  const dependencyArtifacts = (shard.dependencyShardIds || []).flatMap((dependencyShardId) => findArtifacts(artifactBus, { shardId: dependencyShardId })).map((artifact) => ({
    artifactId: artifact.artifactId,
    type: artifact.type,
    shardId: artifact.shardId,
    filePath: artifact.filePath
  }));
  const inputs = { ...(shard.inputs || {}) };
  for (const ref of shard.inputRefs || []) {
    if (Object.prototype.hasOwnProperty.call(globalInputs, ref)) inputs[ref] = globalInputs[ref];
  }
  const relatedSurfaces = (surfaceMatrix.surfaces || []).filter((surface) => (shard.surfaceIds || []).includes(surface.id)).map((surface) => ({ id: surface.id, label: surface.label }));
  const assignmentContract = normalizeAssignmentContract(shard.metadata?.assignmentContract || {}, {
    artifactKind: 'verification_evidence',
    targetFiles: shard.allowedFiles || [],
    targetModules: shard.fileAreas || [],
    verifierRequirements: shard.requiredVerifiers || [],
    successPredicate: shard.acceptanceChecks || []
  });
  const pack = {
    version: 1,
    generatedAt: new Date().toISOString(),
    campaign: {
      requestedFidelity: contract?.requestedFidelity || null,
      scope: contract?.requestedScope || [],
      targetPath: contract?.targetPath || null
    },
    shard: {
      id: shard.id,
      rootWorkUnitId: shard.rootWorkUnitId,
      title: shard.title,
      goal: shard.goal,
      lane: shard.lane,
      domain: shard.domain,
      surfaceIds: shard.surfaceIds || []
    },
    guardrails: {
      allowedFiles: shard.allowedFiles || [],
      fileAreas: shard.fileAreas || [],
      avoidWholeProjectPromptDump: true
    },
    dependencies: {
      shardIds: shard.dependencyShardIds || [],
      artifacts: dependencyArtifacts
    },
    inputs,
    assignmentContract,
    acceptanceChecks: shard.acceptanceChecks || [],
    verifiers: shard.requiredVerifiers || [],
    relatedSurfaces,
    contextFootprint: {
      inputKeyCount: Object.keys(inputs).length,
      dependencyArtifactCount: dependencyArtifacts.length,
      approxBytes: JSON.stringify({ inputs, dependencyArtifacts }).length
    }
  };
  return pack;
}

export function compileContextPacks({ contract, shardPlan, surfaceMatrix, artifactBus, globalInputs = {} }) {
  return shardPlan.shards.map((shard) => compileContextPack({ contract, shard, shardPlan, surfaceMatrix, artifactBus, globalInputs }));
}

export function createPatchArtifact(input = {}) {
  if (!input.id && !input.shardId) throw new Error('patch artifact requires id or shardId');
  return {
    id: input.id || `patch-${input.shardId}`,
    shardId: input.shardId || null,
    taskId: input.taskId || input.shardId || null,
    agentId: input.agentId || null,
    filePaths: stableList(input.filePaths || []),
    diffSummary: input.diffSummary || '',
    requiredVerifiers: stableList(input.requiredVerifiers || ['tests']),
    dependencyShardIds: stableList(input.dependencyShardIds || []),
    createdAt: input.createdAt || new Date().toISOString(),
    metadata: input.metadata || {},
    status: input.status || 'queued'
  };
}

export function createPatchQueue() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    queued: [],
    merged: [],
    rejected: [],
    history: []
  };
}

export function enqueuePatch(queue, artifact) {
  const next = clone(queue);
  next.queued.push(createPatchArtifact(artifact));
  next.history.push({ at: new Date().toISOString(), type: 'patch_enqueued', patchId: artifact.id || `patch-${artifact.shardId}` });
  return next;
}

export function detectPatchConflicts(queue, artifact, { leaseState = createLeaseState(), mergedArtifacts = [] } = {}) {
  const patch = createPatchArtifact(artifact);
  const conflicts = [];
  for (const existing of [...(queue?.queued || []), ...mergedArtifacts]) {
    if (existing.id === patch.id) continue;
    const overlappingFiles = patch.filePaths.filter((filePath) => (existing.filePaths || []).some((otherPath) => overlapsArea(filePath, otherPath)));
    if (overlappingFiles.length) conflicts.push({ type: 'patch_collision', patchId: existing.id, filePaths: overlappingFiles });
  }
  for (const lease of activeLeases(leaseState)) {
    if (lease.taskId === patch.taskId) continue;
    const overlappingFiles = patch.filePaths.filter((filePath) => lease.fileAreas.some((area) => overlapsArea(filePath, area)));
    if (overlappingFiles.length) conflicts.push({ type: 'ownership_collision', patchId: patch.id, ownerTaskId: lease.taskId, ownerAgentId: lease.agentId, filePaths: overlappingFiles });
  }
  return conflicts;
}

export async function processPatchQueue(queue, { leaseState = createLeaseState(), verifyFns = {}, completedShardIds = [], allowProductOnlyVerifierSkip = false } = {}) {
  const next = clone(queue);
  const decisions = [];
  const pending = [];
  const mergedShardIds = new Set([...(completedShardIds || []), ...next.merged.map((artifact) => artifact.shardId)]);

  for (const entry of next.queued) {
    const patch = createPatchArtifact(entry);
    const unmetDependencies = patch.dependencyShardIds.filter((dependencyShardId) => !mergedShardIds.has(dependencyShardId));
    if (unmetDependencies.length) {
      patch.status = 'waiting_dependencies';
      pending.push(patch);
      decisions.push({ patchId: patch.id, status: patch.status, unmetDependencies });
      continue;
    }

    const conflicts = detectPatchConflicts({ queued: pending, merged: next.merged, rejected: next.rejected }, patch, { leaseState, mergedArtifacts: [] });
    if (conflicts.length) {
      patch.status = 'rejected';
      next.rejected.push({ ...patch, rejectedAt: new Date().toISOString(), conflicts });
      decisions.push({ patchId: patch.id, status: 'rejected', conflicts });
      continue;
    }

    const verifierResults = [];
    let verifierFailed = false;
    for (const verifierName of patch.requiredVerifiers) {
      const verifier = verifyFns[verifierName] || (async () => ({ ok: true, verifier: verifierName }));
      const result = await verifier(patch);
      verifierResults.push({ verifier: verifierName, ...result });
      if (result.ok === false) {
        verifierFailed = true;
        patch.status = 'rejected';
        next.rejected.push({ ...patch, rejectedAt: new Date().toISOString(), verifierResults });
        decisions.push({ patchId: patch.id, status: 'rejected', verifierResults });
        break;
      }
    }
    if (verifierFailed) continue;

    const admission = evaluatePatchAdmission(patch, verifierResults, { allowProductOnlyVerifierSkip });
    if (!admission.ok) {
      patch.status = 'rejected';
      patch.rejectionCategory = admission.category;
      patch.rejectionReason = admission.reason;
      patch.admissionAudit = admission.details;
      next.rejected.push({ ...patch, rejectedAt: new Date().toISOString(), verifierResults });
      decisions.push({ patchId: patch.id, status: 'rejected', verifierResults, rejectionCategory: admission.category, rejectionReason: admission.reason });
      continue;
    }

    patch.status = 'merged';
    patch.verifierResults = verifierResults;
    patch.admissionAudit = admission.details;
    patch.mergedAt = new Date().toISOString();
    next.merged.push(patch);
    mergedShardIds.add(patch.shardId);
    decisions.push({ patchId: patch.id, status: 'merged', verifierResults });
  }

  next.queued = pending;
  next.history.push({ at: new Date().toISOString(), type: 'patch_queue_processed', decisions });
  return { queue: next, decisions };
}

function deriveShardStatuses({ shardPlan, leaseState, patchQueue, blockers = [], now = Date.now() }) {
  const mergedShardIds = new Set((patchQueue?.merged || []).map((artifact) => artifact.shardId));
  const unresolvedRejected = (patchQueue?.rejected || []).filter((artifact) => artifact?.shardId && !mergedShardIds.has(artifact.shardId));
  const blockedShardIds = new Set([
    ...blockers.map((entry) => entry.shardId).filter(Boolean),
    ...unresolvedRejected.map((artifact) => artifact.shardId).filter(Boolean)
  ]);
  const activeTaskIds = new Set(activeLeases(leaseState, now).map((lease) => lease.taskId));
  const statuses = {};
  for (const shard of shardPlan.shards) {
    if (mergedShardIds.has(shard.id)) statuses[shard.id] = 'complete';
    else if (blockedShardIds.has(shard.id)) statuses[shard.id] = 'blocked';
    else if (activeTaskIds.has(shard.id)) statuses[shard.id] = 'in_progress';
    else if ((shard.dependencyShardIds || []).every((dependencyShardId) => mergedShardIds.has(dependencyShardId))) statuses[shard.id] = 'ready';
    else statuses[shard.id] = 'pending';
  }
  return statuses;
}

function aggregateSupervision(shards, statuses, key) {
  const groups = {};
  for (const shard of shards) {
    const groupKey = shard[key];
    groups[groupKey] ||= { id: groupKey, total: 0, ready: 0, pending: 0, in_progress: 0, complete: 0, blocked: 0, shardIds: [] };
    groups[groupKey].total += 1;
    groups[groupKey][statuses[shard.id]] += 1;
    groups[groupKey].shardIds.push(shard.id);
  }
  return Object.values(groups).map((group) => ({
    ...group,
    status: group.complete === group.total ? 'green' : group.blocked > 0 ? 'red' : group.in_progress > 0 || group.ready > 0 ? 'amber' : 'red'
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function shardHealth(status) {
  if (status === 'complete') return 'green';
  if (status === 'blocked') return 'red';
  return 'amber';
}

export function compileSupervisorSnapshot({ shardPlan, leaseState = createLeaseState(), patchQueue = createPatchQueue(), artifactBus = createArtifactBus(), blockers = [], now = Date.now() }) {
  const shardStatuses = deriveShardStatuses({ shardPlan, leaseState, patchQueue, blockers, now });
  const lanes = aggregateSupervision(shardPlan.shards, shardStatuses, 'lane');
  const domains = aggregateSupervision(shardPlan.shards, shardStatuses, 'domain');
  const staleLeases = detectStaleLeases(leaseState, { now });
  const mergedShardIds = new Set((patchQueue?.merged || []).map((artifact) => artifact.shardId));
  const unresolvedRejected = (patchQueue?.rejected || []).filter((artifact) => artifact?.shardId && !mergedShardIds.has(artifact.shardId));
  const escalations = [
    ...blockers,
    ...staleLeases.map((lease) => ({ type: 'stale_lease', shardId: lease.taskId, leaseId: lease.leaseId, agentId: lease.agentId })),
    ...unresolvedRejected.map((artifact) => ({ type: 'rejected_patch', shardId: artifact.shardId, patchId: artifact.id }))
  ];
  const counts = Object.values(shardStatuses).reduce((summary, status) => {
    summary[status] += 1;
    return summary;
  }, { ready: 0, pending: 0, in_progress: 0, complete: 0, blocked: 0 });
  const shards = shardPlan.shards.map((shard) => ({
    id: shard.id,
    rootWorkUnitId: shard.rootWorkUnitId,
    lane: shard.lane,
    domain: shard.domain,
    status: shardHealth(shardStatuses[shard.id]),
    state: shardStatuses[shard.id],
    dependencyShardIds: [...(shard.dependencyShardIds || [])],
  }));
  const topLevelStatus = counts.complete === shardPlan.shards.length && escalations.length === 0 && counts.blocked === 0
    ? 'green'
    : escalations.length > 0 || counts.blocked > 0
      ? 'red'
      : 'amber';

  return {
    generatedAt: new Date().toISOString(),
    topLevel: {
      status: topLevelStatus,
      counts,
      shardCount: shardPlan.shards.length,
      escalationCount: escalations.length
    },
    lanes,
    domains,
    shards,
    shardStatuses,
    escalations,
    escalationCount: escalations.length,
    artifactBusSummary: summarizeArtifactBus(artifactBus)
  };
}

export async function runScaleSimulation({
  workGraph,
  surfaceMatrix,
  agentCount,
  maxTicks = 200,
  tickMs = 1000,
  leaseTtlMs = 3 * 1000,
  buildVerifierMap,
  plannerOptions = {}
}) {
  const shardPlan = buildShardPlan({ workGraph, surfaceMatrix, options: plannerOptions });
  const agents = Array.from({ length: agentCount }, (_, index) => `agent-${index + 1}`);
  let leaseState = createLeaseState({ defaultTtlMs: leaseTtlMs });
  let artifactBus = createArtifactBus();
  let patchQueue = createPatchQueue();
  const runtime = Object.fromEntries(shardPlan.shards.map((shard) => [shard.id, {
    remainingSteps: shard.effortSteps,
    stallAttempts: shard.stallAttempts,
    stallAppliedAttempts: [],
    stalledLeaseIds: [],
    merged: false,
    lastLeaseId: null
  }]));
  const assignments = {};
  const verifyFns = buildVerifierMap ? buildVerifierMap({ shardPlan }) : {
    tests: async () => ({ ok: true }),
    lint: async () => ({ ok: true }),
    smoke: async () => ({ ok: true })
  };
  const metrics = {
    conflictsPrevented: 0,
    staleLeaseCount: 0,
    recoveryCount: 0,
    mergedPatchCount: 0,
    shardOutputCount: 0
  };

  function mergedShardIds() {
    return new Set(patchQueue.merged.map((artifact) => artifact.shardId));
  }

  for (let tick = 0; tick < maxTicks; tick += 1) {
    const now = tick * tickMs;
    const staleLeases = detectStaleLeases(leaseState, { now });
    if (staleLeases.length) {
      metrics.staleLeaseCount += staleLeases.length;
      const idleAgents = agents.filter((agentId) => !assignments[agentId]);
      const recovery = recoverStaleLeases(leaseState, { now, agentIds: idleAgents.length ? idleAgents : agents });
      leaseState = recovery.state;
      metrics.recoveryCount += recovery.recoveryActions.length;
      for (const action of recovery.recoveryActions) {
        artifactBus = recordArtifactEvent(artifactBus, { type: 'lease_recovered', taskId: action.taskId, shardId: action.taskId, previousAgentId: action.previousAgentId, nextAgentId: action.nextAgentId });
        for (const [agentId, assignment] of Object.entries(assignments)) {
          if (assignment.shardId === action.taskId) delete assignments[agentId];
        }
        const recoveredLease = leaseState.tasks[action.taskId];
        assignments[action.nextAgentId] = { shardId: action.taskId, leaseId: recoveredLease.leaseId };
      }
    }

    const merged = mergedShardIds();
    const activeShardIds = new Set(Object.values(assignments).map((assignment) => assignment.shardId));
    const readyShards = shardPlan.shards
      .filter((shard) => !merged.has(shard.id) && !activeShardIds.has(shard.id) && (shard.dependencyShardIds || []).every((dependencyShardId) => merged.has(dependencyShardId)))
      .sort((left, right) => left.id.localeCompare(right.id));

    for (const agentId of agents) {
      if (assignments[agentId]) continue;
      const candidateIndex = readyShards.findIndex((candidate) => {
        const conflicts = detectOwnershipConflicts(leaseState, { taskId: candidate.id, agentId, fileAreas: candidate.fileAreas }, now);
        if (conflicts.length) metrics.conflictsPrevented += conflicts.length;
        return conflicts.length === 0;
      });
      if (candidateIndex < 0) continue;
      const shard = readyShards.splice(candidateIndex, 1)[0];
      const acquisition = acquireLease(leaseState, { taskId: shard.id, agentId, fileAreas: shard.fileAreas, ttlMs: leaseTtlMs }, now);
      leaseState = acquisition.state;
      if (!acquisition.ok) {
        metrics.conflictsPrevented += acquisition.conflicts.length;
        continue;
      }
      runtime[shard.id].lastLeaseId = acquisition.lease.leaseId;
      assignments[agentId] = { shardId: shard.id, leaseId: acquisition.lease.leaseId };
      artifactBus = recordArtifactEvent(artifactBus, { type: 'lease_claimed', taskId: shard.id, shardId: shard.id, agentId });
    }

    for (const [agentId, assignment] of Object.entries({ ...assignments })) {
      const shard = shardPlan.shards.find((entry) => entry.id === assignment.shardId);
      const taskLease = leaseState.tasks[assignment.shardId];
      if (!taskLease || taskLease.leaseId !== assignment.leaseId) continue;
      const runtimeEntry = runtime[assignment.shardId];
      if (runtimeEntry.stallAttempts.includes(taskLease.attempt) && !runtimeEntry.stallAppliedAttempts.includes(taskLease.attempt)) {
        runtimeEntry.stallAppliedAttempts.push(taskLease.attempt);
        runtimeEntry.stalledLeaseIds.push(taskLease.leaseId);
        artifactBus = recordArtifactEvent(artifactBus, { type: 'worker_stalled', taskId: shard.id, shardId: shard.id, agentId, attempt: taskLease.attempt });
        continue;
      }
      if (runtimeEntry.stalledLeaseIds.includes(taskLease.leaseId)) continue;

      runtimeEntry.remainingSteps -= 1;
      if (runtimeEntry.remainingSteps > 0) continue;

      const publishResult = publishArtifact(artifactBus, {
        type: 'shard_output',
        shardId: shard.id,
        taskId: shard.id,
        producer: agentId,
        filePath: `artifacts/${shard.id}.json`,
        metadata: { lane: shard.lane, domain: shard.domain }
      });
      artifactBus = publishResult.bus;
      metrics.shardOutputCount += 1;
      const released = releaseLease(leaseState, { leaseId: taskLease.leaseId, agentId, reason: 'completed' }, now);
      leaseState = released.state;
      delete assignments[agentId];
      patchQueue = enqueuePatch(patchQueue, createPatchArtifact({
        shardId: shard.id,
        taskId: shard.id,
        agentId,
        filePaths: shard.allowedFiles.length ? shard.allowedFiles : shard.fileAreas,
        diffSummary: `${shard.title} patch`,
        requiredVerifiers: shard.requiredVerifiers,
        dependencyShardIds: shard.dependencyShardIds,
        metadata: {
          assignmentContract: shard.metadata?.assignmentContract || null
        }
      }));
    }

    const queueResult = await processPatchQueue(patchQueue, { leaseState, verifyFns, completedShardIds: [...merged] });
    patchQueue = queueResult.queue;
    for (const decision of queueResult.decisions.filter((entry) => entry.status === 'merged')) {
      metrics.mergedPatchCount += 1;
      const patch = patchQueue.merged.find((entry) => entry.id === decision.patchId);
      if (patch) {
        artifactBus = publishArtifact(artifactBus, {
          type: 'patch_merged',
          shardId: patch.shardId,
          taskId: patch.taskId,
          producer: patch.agentId,
          filePath: `merge/${patch.id}.json`
        }).bus;
      }
    }

    if (patchQueue.merged.length === shardPlan.shards.length) break;
  }

  const supervisor = compileSupervisorSnapshot({ shardPlan, leaseState, patchQueue, artifactBus, now: maxTicks * tickMs });
  const continuityFailures = shardPlan.shards.filter((shard) => {
    const outputs = findArtifacts(artifactBus, { shardId: shard.id }).filter((artifact) => artifact.type === 'shard_output');
    const merges = findArtifacts(artifactBus, { shardId: shard.id }).filter((artifact) => artifact.type === 'patch_merged');
    return outputs.length === 0 || merges.length === 0;
  }).map((shard) => shard.id);

  return {
    ok: patchQueue.merged.length === shardPlan.shards.length && supervisor.topLevel.status === 'green' && continuityFailures.length === 0,
    agentCount,
    shardCount: shardPlan.shards.length,
    mergedShardCount: patchQueue.merged.length,
    supervisor,
    metrics: {
      ...metrics,
      stateLossEvents: continuityFailures.length,
      continuityFailures
    },
    shardPlan,
    leaseState,
    artifactBus,
    patchQueue
  };
}

export async function qualifyScaleTiers({ tiers = [4, 8, 16, 32], workGraph, surfaceMatrix, options = {} }) {
  const results = [];
  for (const tier of tiers) {
    const simulation = await runScaleSimulation({ workGraph, surfaceMatrix, agentCount: tier, ...options });
    results.push({
      tier,
      ok: simulation.ok,
      shardCount: simulation.shardCount,
      mergedShardCount: simulation.mergedShardCount,
      supervisorStatus: simulation.supervisor.topLevel.status,
      recoveryCount: simulation.metrics.recoveryCount,
      staleLeaseCount: simulation.metrics.staleLeaseCount,
      stateLossEvents: simulation.metrics.stateLossEvents,
      simulation
    });
    if (!simulation.ok) break;
  }

  const passing = results.filter((entry) => entry.ok).map((entry) => entry.tier);
  return {
    generatedAt: new Date().toISOString(),
    tiers: results.map((entry) => ({
      tier: entry.tier,
      ok: entry.ok,
      shardCount: entry.shardCount,
      mergedShardCount: entry.mergedShardCount,
      supervisorStatus: entry.supervisorStatus,
      recoveryCount: entry.recoveryCount,
      staleLeaseCount: entry.staleLeaseCount,
      stateLossEvents: entry.stateLossEvents
    })),
    highestPassingTier: passing.length ? Math.max(...passing) : null,
    allRequestedTiersPassed: results.every((entry) => entry.ok),
    rawResults: results
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function collectRecordedVerifierResult(resultPath, verifierName) {
  const result = loadJson(resultPath, null);
  const recorded = result?.verifierResults?.find((entry) => entry.verifier === verifierName);
  if (!recorded) return { ok: false, verifier: verifierName, error: 'verifier_result_missing', resultPath };
  return {
    ok: recorded.ok !== false,
    verifier: verifierName,
    command: recorded.command || null,
    durationMs: recorded.durationMs || 0,
    stdout: recorded.stdout || '',
    stderr: recorded.stderr || '',
    skipped: recorded.skipped === true,
    reason: recorded.reason || null,
    resultPath
  };
}

export function createRecordedVerifierMap() {
  return {
    tests: async (patch) => collectRecordedVerifierResult(patch.metadata?.resultPath, 'tests'),
    lint: async (patch) => collectRecordedVerifierResult(patch.metadata?.resultPath, 'lint'),
    imports: async (patch) => collectRecordedVerifierResult(patch.metadata?.resultPath, 'imports'),
    smoke: async (patch) => collectRecordedVerifierResult(patch.metadata?.resultPath, 'smoke')
  };
}

function evaluatePatchAdmission(patch, verifierResults = [], { allowProductOnlyVerifierSkip = false } = {}) {
  const assignmentContract = normalizeAssignmentContract(patch.metadata?.assignmentContract || {}, {
    artifactKind: patch.filePaths?.length ? 'product_diff' : 'verification_evidence',
    targetFiles: patch.filePaths || [],
    verifierRequirements: patch.requiredVerifiers || [],
    successPredicate: patch.metadata?.contextPack?.acceptanceChecks || []
  });
  const grounded = validateGroundedAssignmentContract(assignmentContract);
  if (!grounded.ok) {
    return {
      ok: false,
      category: 'planner_failure',
      reason: 'ungrounded_assignment_contract',
      details: {
        failures: grounded.failures,
        assignmentContract
      }
    };
  }

  const modifiedFiles = stableList(patch.metadata?.implementation?.modifiedFiles || patch.filePaths || []);
  const touchedTargetFiles = assignmentContract.targetFiles.length === 0
    ? modifiedFiles
    : modifiedFiles.filter((filePath) => assignmentContract.targetFiles.some((targetPath) => overlapsArea(filePath, targetPath)));
  const outOfScopeFiles = assignmentContract.targetFiles.length === 0
    ? []
    : modifiedFiles.filter((filePath) => !assignmentContract.targetFiles.some((targetPath) => overlapsArea(filePath, targetPath)));
  const nonSkippedVerifierPass = verifierResults.some((result) => result?.ok !== false && result?.skipped !== true);
  const productOnlyVerifierSkip = verifierResults.some((result) => result?.ok !== false && result?.skipped === true && result?.reason === 'product_only_mode');
  const productOnlySkipAllowed = Boolean(allowProductOnlyVerifierSkip || patch.metadata?.allowProductOnlyVerifierSkip === true || patch.metadata?.contextPack?.guardrails?.allowProductOnlyVerifierSkip === true);
  const admissibleVerifierEvidence = nonSkippedVerifierPass
    || (assignmentContract.artifactKind === 'product_diff' && touchedTargetFiles.length > 0 && productOnlyVerifierSkip && productOnlySkipAllowed);

  if (assignmentContract.artifactKind === 'product_diff') {
    if (modifiedFiles.length === 0) {
      return {
        ok: false,
        category: 'no_op',
        reason: 'zero_modified_files',
        details: { assignmentContract, modifiedFiles }
      };
    }
    if (touchedTargetFiles.length === 0) {
      return {
        ok: false,
        category: 'planner_failure',
        reason: 'out_of_scope_modified_files',
        details: { assignmentContract, modifiedFiles, outOfScopeFiles }
      };
    }
    if (!admissibleVerifierEvidence) {
      return {
        ok: false,
        category: 'no_op',
        reason: 'no_non_skipped_verifier_evidence',
        details: { assignmentContract, modifiedFiles, verifierResults, productOnlyVerifierSkip, productOnlySkipAllowed }
      };
    }
  } else if (!nonSkippedVerifierPass) {
    return {
      ok: false,
      category: 'no_op',
      reason: 'no_non_skipped_verifier_evidence',
      details: { assignmentContract, verifierResults }
    };
  }

  return {
    ok: true,
    details: {
      assignmentContract,
      modifiedFiles,
      touchedTargetFiles,
      outOfScopeFiles,
      nonSkippedVerifierPass,
      productOnlyVerifierSkip,
      productOnlySkipAllowed,
      admissibleVerifierEvidence
    }
  };
}

function normalizeFailureInjections(failureInjections = []) {
  const byShard = new Map();
  for (const injection of failureInjections || []) {
    if (!injection?.shardId) continue;
    const key = `${injection.shardId}:${Number(injection.attempt || 1)}`;
    byShard.set(key, {
      shardId: injection.shardId,
      attempt: Number(injection.attempt || 1),
      mode: injection.mode || 'stall',
      delayMs: Number(injection.delayMs || 0),
      note: injection.note || null
    });
  }
  return byShard;
}

function createRunDirectories(rootPath) {
  return {
    root: ensureDir(rootPath),
    assignments: ensureDir(path.join(rootPath, 'assignments')),
    results: ensureDir(path.join(rootPath, 'results')),
    logs: ensureDir(path.join(rootPath, 'logs'))
  };
}

function createLiveWorkerAssignment({ directories, shard, pack, workspacePath, workerScriptPath, verifierScriptPath, implementationScriptPath, lease, agentId, failureInjection, executionMode }) {
  const assignment = {
    version: 1,
    generatedAt: new Date().toISOString(),
    executionMode,
    workerScriptPath,
    verifierScriptPath,
    implementationScriptPath: implementationScriptPath || shard.metadata?.implementationScriptPath || null,
    workspacePath,
    shard,
    contextPack: pack,
    lease,
    agentId,
    resultPath: path.join(directories.results, `${shard.id}__attempt-${lease.attempt}.json`),
    logPath: path.join(directories.logs, `${shard.id}__attempt-${lease.attempt}.log`),
    failureInjection: failureInjection || null
  };
  const assignmentPath = path.join(directories.assignments, `${shard.id}__attempt-${lease.attempt}.json`);
  saveJson(assignmentPath, assignment);
  return { assignmentPath, assignment };
}

function killWorker(info) {
  if (!info?.child || info.child.exitCode !== null || info.child.signalCode !== null) return;
  try {
    info.child.kill('SIGKILL');
  } catch {}
}

function appendNodeOption(existing, nextOption) {
  const current = String(existing || '').trim();
  const parts = current ? current.split(/\s+/).filter(Boolean) : [];
  if (!parts.includes(nextOption)) parts.push(nextOption);
  return parts.join(' ').trim();
}

function createOutputCollector(limitBytes = 16 * 1024) {
  const maxBytes = Math.max(1024, Number(limitBytes || 16 * 1024));
  let chunks = [];
  let totalBytes = 0;
  return {
    push(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''), 'utf8');
      if (!buffer.length) return;
      chunks.push(buffer);
      totalBytes += buffer.length;
      while (totalBytes > maxBytes && chunks.length) {
        const first = chunks[0];
        const overflow = totalBytes - maxBytes;
        if (overflow >= first.length) {
          chunks.shift();
          totalBytes -= first.length;
          continue;
        }
        chunks[0] = first.subarray(overflow);
        totalBytes -= overflow;
        break;
      }
    },
    text() {
      return Buffer.concat(chunks).toString('utf8');
    }
  };
}

function spawnLiveWorker({ workerScriptPath, assignmentPath, cwd, workerMemoryLimitMb = 96, outputCaptureBytes = 16 * 1024 }) {
  const env = {
    ...process.env,
    NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, `--max-old-space-size=${Math.max(32, Number(workerMemoryLimitMb || 96))}`)
  };
  const child = spawn(process.execPath, [workerScriptPath, '--assignment', assignmentPath], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env
  });
  const stdout = createOutputCollector(outputCaptureBytes);
  const stderr = createOutputCollector(outputCaptureBytes);
  child.stdout?.on('data', (chunk) => stdout.push(chunk));
  child.stderr?.on('data', (chunk) => stderr.push(chunk));
  return { child, stdout, stderr };
}

export async function runLiveWorkerFarm({
  workGraph,
  surfaceMatrix,
  agentCount,
  workerScriptPath,
  verifierScriptPath,
  implementationScriptPath = null,
  workspacePath,
  runRoot,
  maxRuntimeMs = 120000,
  pollMs = 25,
  leaseTtlMs = 2000,
  maxAttemptsPerTask = Number(process.env.ORCHESTRATOR_MAX_ATTEMPTS_PER_TASK || 4),
  workerMemoryLimitMb = Number(process.env.ORCHESTRATOR_WORKER_MAX_OLD_SPACE_MB || 96),
  outputCaptureBytes = Number(process.env.ORCHESTRATOR_WORKER_OUTPUT_CAPTURE_BYTES || 16 * 1024),
  maxSpawnsPerTick = Number(process.env.ORCHESTRATOR_MAX_SPAWNS_PER_TICK || agentCount),
  plannerOptions = {},
  failureInjections = [],
  globalInputs = {},
  verifyFns = createRecordedVerifierMap(),
  executionMode = 'live_multiprocess_worker_farm',
  campaignContract = null,
  allowProductOnlyVerifierSkip = false
}) {
  const shardPlan = buildShardPlan({ workGraph, surfaceMatrix, options: plannerOptions });
  const frontier = summarizeShardFrontier(shardPlan.shards);
  const directories = createRunDirectories(runRoot);
  let leaseState = createLeaseState({ defaultTtlMs: leaseTtlMs });
  let artifactBus = createArtifactBus({ rootPath: runRoot });
  let patchQueue = createPatchQueue();
  const effectiveCampaignContract = {
    requestedFidelity: campaignContract?.fidelity || campaignContract?.requestedFidelity || 'production_slice',
    requestedScope: campaignContract?.requestedScope
      || (Array.isArray(campaignContract?.scope?.surfaces) ? campaignContract.scope.surfaces.map((surface) => surface.id).filter(Boolean) : null)
      || ['live-worker-qualification'],
    targetPath: campaignContract?.targetPath || campaignContract?.repoPath || workGraph.targetPath || workspacePath
  };
  const contextPacks = compileContextPacks({ contract: effectiveCampaignContract, shardPlan, surfaceMatrix, artifactBus, globalInputs });
  const packByShardId = new Map(contextPacks.map((pack) => [pack.shard.id, pack]));
  const shardById = new Map(shardPlan.shards.map((shard) => [shard.id, shard]));
  const groundingFailures = shardPlan.shards
    .map((shard) => {
      const assignmentContract = normalizeAssignmentContract(shard.metadata?.assignmentContract || {}, {
        artifactKind: 'verification_evidence',
        targetFiles: shard.allowedFiles || [],
        targetModules: shard.fileAreas || [],
        verifierRequirements: shard.requiredVerifiers || [],
        successPredicate: shard.acceptanceChecks || []
      });
      const grounded = validateGroundedAssignmentContract(assignmentContract);
      if (grounded.ok) return null;
      return {
        type: 'planner_failure',
        shardId: shard.id,
        reason: 'ungrounded_assignment_contract',
        failures: grounded.failures,
        assignmentContract
      };
    })
    .filter(Boolean);
  saveJson(path.join(runRoot, 'assignment_contract_audit.json'), {
    generatedAt: new Date().toISOString(),
    shardCount: shardPlan.shards.length,
    invalidShardCount: groundingFailures.length,
    invalidShards: groundingFailures
  });
  const injectionMap = normalizeFailureInjections(failureInjections);
  const agents = Array.from({ length: agentCount }, (_, index) => `agent-${index + 1}`);
  const activeWorkers = new Map();
  const metrics = {
    workerSpawnCount: 0,
    workerExitFailures: 0,
    staleLeaseCount: 0,
    recoveryCount: 0,
    crashInjectionCount: 0,
    stallInjectionCount: 0,
    mergedPatchCount: 0,
    shardOutputCount: 0,
    lateResultsIgnored: 0
  };
  const workerEvents = [];
  const startedAt = Date.now();

  function recordWorkerEvent(event) {
    const entry = { at: new Date().toISOString(), ...event };
    workerEvents.push(entry);
    artifactBus = recordArtifactEvent(artifactBus, entry);
  }

  function mergedShardIds() {
    return new Set((patchQueue.merged || []).map((artifact) => artifact.shardId));
  }

  if (groundingFailures.length > 0) {
    const supervisor = compileSupervisorSnapshot({ shardPlan, leaseState, patchQueue, artifactBus, blockers: groundingFailures, now: Date.now() });
    const summary = {
      generatedAt: new Date().toISOString(),
      executionMode,
      agentCount,
      shardCount: shardPlan.shards.length,
      frontier,
      mergedShardCount: 0,
      elapsedMs: 0,
      metrics: {
        ...metrics,
        maxAttemptsPerTask,
        failedShards: [],
        plannerFailures: groundingFailures,
        stateLossEvents: 0,
        continuityFailures: []
      }
    };
    saveJson(path.join(runRoot, 'summary.json'), summary);
    saveJson(path.join(runRoot, 'worker_events.json'), workerEvents);
    saveJson(path.join(runRoot, 'lease_state.json'), leaseState);
    saveJson(path.join(runRoot, 'patch_queue.json'), patchQueue);
    saveJson(path.join(runRoot, 'artifact_bus.json'), artifactBus);
    saveJson(path.join(runRoot, 'supervisor.json'), supervisor);
    return {
      ok: false,
      executionMode,
      agentCount,
      shardPlan,
      frontier,
      summary,
      supervisor,
      metrics: summary.metrics,
      leaseState,
      patchQueue,
      artifactBus,
      runRoot
    };
  }

  function clearWorker(agentId) {
    const info = activeWorkers.get(agentId);
    if (!info) return;
    activeWorkers.delete(agentId);
  }

  function reserveAgentIds() {
    return agents.filter((agentId) => !activeWorkers.has(agentId));
  }

  function finalizeResult(agentId, info) {
    if (!info || info.processed) return;
    info.processed = true;
    const currentLease = leaseState.tasks[info.shardId];
    const result = loadJson(info.resultPath, null);
    const childStdout = info.stdout?.text?.() || '';
    const childStderr = info.stderr?.text?.() || '';

    if (!result || info.exitCode !== 0) {
      metrics.workerExitFailures += info.exitCode === 0 ? 0 : 1;
      leaseState = releaseLease(leaseState, { leaseId: info.leaseId, agentId, reason: 'failed' }).state;
      recordWorkerEvent({ type: 'live_worker_exit', shardId: info.shardId, agentId, leaseId: info.leaseId, exitCode: info.exitCode, signalCode: info.signalCode, ok: false });
      clearWorker(agentId);
      return;
    }

    if (!currentLease || currentLease.leaseId !== info.leaseId) {
      metrics.lateResultsIgnored += 1;
      recordWorkerEvent({ type: 'late_result_ignored', shardId: info.shardId, agentId, leaseId: info.leaseId, currentLeaseId: currentLease?.leaseId || null, resultPath: info.resultPath });
      clearWorker(agentId);
      return;
    }

    const publishResult = publishArtifact(artifactBus, {
      type: 'shard_output',
      shardId: info.shardId,
      taskId: info.shardId,
      producer: agentId,
      filePath: info.resultPath,
      metadata: {
        executionMode,
        resultPath: info.resultPath,
        implementation: result.implementation || null,
        verifierResults: result.verifierResults || [],
        stdout: childStdout,
        stderr: childStderr
      }
    });
    artifactBus = publishResult.bus;
    metrics.shardOutputCount += 1;
    leaseState = releaseLease(leaseState, { leaseId: info.leaseId, agentId, reason: 'completed' }).state;
    const changedFiles = stableList(result?.implementation?.modifiedFiles || []);
    patchQueue = enqueuePatch(patchQueue, createPatchArtifact({
      shardId: info.shardId,
      taskId: info.shardId,
      agentId,
      filePaths: changedFiles,
      diffSummary: result?.implementation?.diffSummary || `verified ${info.shardId}`,
      requiredVerifiers: shardById.get(info.shardId)?.requiredVerifiers || ['tests'],
      dependencyShardIds: shardById.get(info.shardId)?.dependencyShardIds || [],
      metadata: {
        executionMode,
        resultPath: info.resultPath,
        implementation: result.implementation || null,
        verifierResults: result.verifierResults || [],
        assignmentContract: shardById.get(info.shardId)?.metadata?.assignmentContract || null,
        contextPack: packByShardId.get(info.shardId) || null
      }
    }));
    recordWorkerEvent({ type: 'live_worker_exit', shardId: info.shardId, agentId, leaseId: info.leaseId, exitCode: info.exitCode, signalCode: info.signalCode, ok: true, resultPath: info.resultPath });
    clearWorker(agentId);
  }

  while (Date.now() - startedAt < maxRuntimeMs) {
    for (const [agentId, info] of [...activeWorkers.entries()]) {
      if (info.child.exitCode !== null || info.child.signalCode !== null) {
        info.exitCode = info.child.exitCode;
        info.signalCode = info.child.signalCode;
        finalizeResult(agentId, info);
      }
    }

    const now = Date.now();
    const staleLeases = detectStaleLeases(leaseState, { now });
    if (staleLeases.length) {
      metrics.staleLeaseCount += staleLeases.length;
      for (const stale of staleLeases) {
        const ownerAgentId = [...activeWorkers.entries()].find(([, info]) => info.leaseId === stale.leaseId)?.[0];
        if (ownerAgentId) {
          killWorker(activeWorkers.get(ownerAgentId));
          clearWorker(ownerAgentId);
        }
      }
      const recovery = recoverStaleLeases(leaseState, { now, agentIds: reserveAgentIds() });
      leaseState = recovery.state;
      metrics.recoveryCount += recovery.recoveryActions.length;
      for (const action of recovery.recoveryActions) {
        recordWorkerEvent({ type: 'lease_recovered', shardId: action.taskId, previousAgentId: action.previousAgentId, nextAgentId: action.nextAgentId, previousLeaseId: action.previousLeaseId, nextLeaseId: action.nextLeaseId });
      }
    }

    const recoveredReservations = activeLeases(leaseState, now)
      .filter((lease) => lease.metadata?.recoveredFrom && !activeWorkers.has(lease.agentId))
      .sort((left, right) => left.taskId.localeCompare(right.taskId));

    for (const lease of recoveredReservations) {
      const shard = shardById.get(lease.taskId);
      if (!shard) continue;
      const { assignmentPath, assignment } = createLiveWorkerAssignment({
        directories,
        shard,
        pack: packByShardId.get(shard.id),
        workspacePath,
        workerScriptPath,
        verifierScriptPath,
        implementationScriptPath,
        lease,
        agentId: lease.agentId,
        failureInjection: null,
        executionMode
      });
      const spawned = spawnLiveWorker({
        workerScriptPath,
        assignmentPath,
        cwd: path.dirname(workerScriptPath),
        workerMemoryLimitMb,
        outputCaptureBytes
      });
      activeWorkers.set(lease.agentId, {
        shardId: shard.id,
        leaseId: lease.leaseId,
        resultPath: assignment.resultPath,
        child: spawned.child,
        stdout: spawned.stdout,
        stderr: spawned.stderr,
        processed: false,
        assignmentPath
      });
      metrics.workerSpawnCount += 1;
      recordWorkerEvent({ type: 'live_worker_respawned', shardId: shard.id, agentId: lease.agentId, leaseId: lease.leaseId, attempt: lease.attempt, recoveredFrom: lease.metadata?.recoveredFrom || null });
    }

    const merged = mergedShardIds();
    const activeShardIds = new Set([...activeWorkers.values()].map((info) => info.shardId));
    const leasedShardIds = new Set(activeLeases(leaseState, now).map((lease) => lease.taskId));
    const queuedShardIds = new Set((patchQueue.queued || []).map((artifact) => artifact.shardId));
    const readyShards = shardPlan.shards
      .filter((shard) => !merged.has(shard.id) && !queuedShardIds.has(shard.id) && !activeShardIds.has(shard.id) && !leasedShardIds.has(shard.id) && Number(leaseState.taskAttempts?.[shard.id] || 0) < maxAttemptsPerTask && (shard.dependencyShardIds || []).every((dependencyShardId) => merged.has(dependencyShardId)))
      .sort((left, right) => left.id.localeCompare(right.id));

    let spawnedThisTick = 0;
    for (const agentId of reserveAgentIds()) {
      if (spawnedThisTick >= Math.max(1, Number(maxSpawnsPerTick || agentCount))) break;
      const shard = readyShards.shift();
      if (!shard) break;
      const acquisition = acquireLease(leaseState, { taskId: shard.id, agentId, fileAreas: shard.fileAreas, ttlMs: leaseTtlMs }, now);
      leaseState = acquisition.state;
      if (!acquisition.ok) continue;
      const failureInjection = injectionMap.get(`${shard.id}:${acquisition.lease.attempt}`) || null;
      if (failureInjection?.mode === 'stall') metrics.stallInjectionCount += 1;
      if (failureInjection?.mode === 'crash') metrics.crashInjectionCount += 1;
      const { assignmentPath, assignment } = createLiveWorkerAssignment({
        directories,
        shard,
        pack: packByShardId.get(shard.id),
        workspacePath,
        workerScriptPath,
        verifierScriptPath,
        implementationScriptPath,
        lease: acquisition.lease,
        agentId,
        failureInjection,
        executionMode
      });
      const spawned = spawnLiveWorker({
        workerScriptPath,
        assignmentPath,
        cwd: path.dirname(workerScriptPath),
        workerMemoryLimitMb,
        outputCaptureBytes
      });
      activeWorkers.set(agentId, {
        shardId: shard.id,
        leaseId: acquisition.lease.leaseId,
        resultPath: assignment.resultPath,
        child: spawned.child,
        stdout: spawned.stdout,
        stderr: spawned.stderr,
        processed: false,
        assignmentPath
      });
      metrics.workerSpawnCount += 1;
      spawnedThisTick += 1;
      recordWorkerEvent({ type: 'live_worker_spawned', shardId: shard.id, agentId, leaseId: acquisition.lease.leaseId, attempt: acquisition.lease.attempt, failureInjection });
    }

    const queueResult = await processPatchQueue(patchQueue, { leaseState, verifyFns, completedShardIds: [...merged], allowProductOnlyVerifierSkip });
    patchQueue = queueResult.queue;
    for (const decision of queueResult.decisions.filter((entry) => entry.status === 'merged')) {
      const patch = patchQueue.merged.find((entry) => entry.id === decision.patchId);
      if (patch) {
        metrics.mergedPatchCount += 1;
        artifactBus = publishArtifact(artifactBus, {
          type: 'patch_merged',
          shardId: patch.shardId,
          taskId: patch.taskId,
          producer: patch.agentId,
          filePath: patch.metadata?.resultPath || `merge/${patch.id}.json`,
          metadata: { executionMode, verifierResults: patch.verifierResults || [] }
        }).bus;
      }
    }

    const failedShards = detectFailedShards({ shardPlan, patchQueue, leaseState, maxAttemptsPerTask });
    if (failedShards.length) {
      recordWorkerEvent({ type: 'shard_attempts_exhausted', failedShards });
      break;
    }

    if (patchQueue.merged.length === shardPlan.shards.length) break;
    await sleep(pollMs);
  }

  for (const info of activeWorkers.values()) killWorker(info);
  await sleep(10);
  for (const [agentId, info] of [...activeWorkers.entries()]) {
    info.exitCode = info.child.exitCode;
    info.signalCode = info.child.signalCode;
    finalizeResult(agentId, info);
  }

  const supervisor = compileSupervisorSnapshot({ shardPlan, leaseState, patchQueue, artifactBus, now: Date.now() });
  const failedShards = detectFailedShards({ shardPlan, patchQueue, leaseState, maxAttemptsPerTask });
  const continuityFailures = shardPlan.shards.filter((shard) => {
    const outputs = findArtifacts(artifactBus, { shardId: shard.id }).filter((artifact) => artifact.type === 'shard_output');
    const merges = findArtifacts(artifactBus, { shardId: shard.id }).filter((artifact) => artifact.type === 'patch_merged');
    return outputs.length === 0 || merges.length === 0;
  }).map((shard) => shard.id);

  const summary = {
    generatedAt: new Date().toISOString(),
    executionMode,
    agentCount,
    shardCount: shardPlan.shards.length,
    frontier,
    mergedShardCount: patchQueue.merged.length,
    elapsedMs: Date.now() - startedAt,
    metrics: {
      ...metrics,
      maxAttemptsPerTask,
      failedShards,
      stateLossEvents: continuityFailures.length,
      continuityFailures
    }
  };
  saveJson(path.join(runRoot, 'summary.json'), summary);
  saveJson(path.join(runRoot, 'worker_events.json'), workerEvents);
  saveJson(path.join(runRoot, 'lease_state.json'), leaseState);
  saveJson(path.join(runRoot, 'patch_queue.json'), patchQueue);
  saveJson(path.join(runRoot, 'artifact_bus.json'), artifactBus);
  saveJson(path.join(runRoot, 'supervisor.json'), supervisor);

  return {
    ok: patchQueue.merged.length === shardPlan.shards.length && supervisor.topLevel.status === 'green' && continuityFailures.length === 0 && failedShards.length === 0,
    executionMode,
    agentCount,
    shardPlan,
    frontier,
    leaseState,
    artifactBus,
    patchQueue,
    supervisor,
    workerEvents,
    summary,
    metrics: summary.metrics,
    runRoot
  };
}

export async function qualifyLiveScaleTiers({ tiers = [32, 64, 100], workGraph, surfaceMatrix, options = {} }) {
  const results = [];
  for (const tier of tiers) {
    const liveRun = await runLiveWorkerFarm({ workGraph, surfaceMatrix, agentCount: tier, ...options, runRoot: path.join(options.runRoot || process.cwd(), `tier-${String(tier).padStart(3, '0')}`) });
    results.push({
      tier,
      ok: liveRun.ok,
      shardCount: liveRun.shardPlan.shards.length,
      mergedShardCount: liveRun.patchQueue.merged.length,
      supervisorStatus: liveRun.supervisor.topLevel.status,
      recoveryCount: liveRun.metrics.recoveryCount,
      staleLeaseCount: liveRun.metrics.staleLeaseCount,
      stateLossEvents: liveRun.metrics.stateLossEvents,
      executionMode: liveRun.executionMode,
      elapsedMs: liveRun.summary.elapsedMs,
      liveRun
    });
    if (!liveRun.ok) break;
  }

  const passing = results.filter((entry) => entry.ok).map((entry) => entry.tier);
  return {
    generatedAt: new Date().toISOString(),
    tiers: results.map((entry) => ({
      tier: entry.tier,
      ok: entry.ok,
      shardCount: entry.shardCount,
      mergedShardCount: entry.mergedShardCount,
      supervisorStatus: entry.supervisorStatus,
      recoveryCount: entry.recoveryCount,
      staleLeaseCount: entry.staleLeaseCount,
      stateLossEvents: entry.stateLossEvents,
      executionMode: entry.executionMode,
      elapsedMs: entry.elapsedMs
    })),
    highestPassingTier: passing.length ? Math.max(...passing) : null,
    allRequestedTiersPassed: results.length === tiers.length && results.every((entry) => entry.ok),
    rawResults: results
  };
}

export function saveJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return payload;
}

export function loadJson(filePath, fallback = null) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
}
