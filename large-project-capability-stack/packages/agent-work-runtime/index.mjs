import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { reduceRunState } from '../orchestrator-run-state/index.mjs';

export const AGENT_WORK_RUNTIME_SCHEMA = 'clawd.agent_work.runtime.v1';
export const AGENT_WORK_RUNTIME_STATE_SCHEMA = 'clawd.agent_work.runtime_state.v1';
export const AGENT_WORK_RUNTIME_EVENT_SCHEMA = 'clawd.agent_work.runtime_event.v1';
export const AGENT_WORK_RUNTIME_PROJECTION_SCHEMA = 'clawd.agent_work.runtime_projection.v1';
export const AGENT_WORK_RUNTIME_RECOVERY_PACKET_SCHEMA = 'clawd.agent_work.runtime_recovery_packet.v1';
export const AGENT_WORK_RUNTIME_DB_SCHEMA_VERSION = 1;

const TERMINAL_TASK_STATES = new Set(['accepted', 'rejected', 'conflicted', 'blocked']);

function nowIso() {
  return new Date().toISOString();
}

function clean(value = '') {
  return String(value ?? '').trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function sha256(value) {
  const payload = Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(stableValue(value));
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function appendJsonLine(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function readRuntimeEvents(eventsPath) {
  return readJsonLines(eventsPath);
}

function stateDigest(state) {
  return sha256(state);
}

function defaultState({ runId, generatedAt = nowIso() } = {}) {
  return {
    schemaVersion: AGENT_WORK_RUNTIME_STATE_SCHEMA,
    generatedAt,
    runId: runId || 'unknown_run',
    stateVersion: 0,
    runState: 'draft',
    paused: false,
    cancelled: false,
    blocker: null,
    tasks: {},
    leases: {},
    artifacts: {},
    budget: { tokensUsed: 0, providerCalls: 0, workerSpawns: 0, retries: 0 },
    remoteHeartbeat: null,
    acceptedPatchIds: [],
    truth: null
  };
}

function createEvent({ sequence, previousDigest, type, runId, entityType = 'run', entityId = runId, idempotencyKey, payload = {}, generatedAt = nowIso() }) {
  const event = {
    schemaVersion: AGENT_WORK_RUNTIME_EVENT_SCHEMA,
    sequence,
    generatedAt,
    type,
    runId,
    entityType,
    entityId,
    idempotencyKey,
    payload,
    previousDigest
  };
  event.eventDigest = sha256({ ...event, eventDigest: undefined });
  return event;
}

function applyEvent(state, event) {
  const next = clone(state);
  next.generatedAt = event.generatedAt || next.generatedAt;
  next.runId = event.runId || next.runId;
  next.stateVersion = Math.max(next.stateVersion + 1, Number(event.payload?.stateVersion || 0), Number(event.sequence || 0));
  switch (event.type) {
    case 'runtime_initialized': {
      next.runState = event.payload?.runState || 'compiled';
      next.runManifest = event.payload?.runManifest || next.runManifest || null;
      next.contractBundleDigest = event.payload?.contractBundleDigest || next.contractBundleDigest || null;
      break;
    }
    case 'task_registered': {
      const task = event.payload?.task || {};
      next.tasks[task.taskId] = {
        ...task,
        state: task.state || 'proposed',
        stateVersion: task.stateVersion || 1,
        acceptedPatchIds: task.acceptedPatchIds || []
      };
      break;
    }
    case 'task_transitioned': {
      const { taskId, state: taskState, stateVersion, patchId = null, reason = null } = event.payload || {};
      const current = next.tasks[taskId] || { taskId, acceptedPatchIds: [] };
      next.tasks[taskId] = { ...current, state: taskState, stateVersion, patchId, reason, updatedAt: event.generatedAt };
      if (taskState === 'accepted' && patchId && !next.acceptedPatchIds.includes(patchId)) {
        next.acceptedPatchIds.push(patchId);
        next.tasks[taskId].acceptedPatchIds = [...new Set([...(next.tasks[taskId].acceptedPatchIds || []), patchId])];
      }
      break;
    }
    case 'lease_acquired': {
      const { leaseId, taskId, workerId, fencingToken, expiresAt } = event.payload || {};
      next.leases[leaseId] = { leaseId, taskId, workerId, fencingToken, expiresAt, state: 'active', acquiredAt: event.generatedAt };
      if (next.tasks[taskId]) next.tasks[taskId] = { ...next.tasks[taskId], state: 'leased', activeLeaseId: leaseId, activeFencingToken: fencingToken, updatedAt: event.generatedAt };
      break;
    }
    case 'lease_replaced':
    case 'lease_expired':
    case 'lease_released': {
      const { leaseId, reason } = event.payload || {};
      if (next.leases[leaseId]) next.leases[leaseId] = { ...next.leases[leaseId], state: event.type.replace('lease_', ''), reason, updatedAt: event.generatedAt };
      break;
    }
    case 'artifact_indexed': {
      const artifact = event.payload?.artifact || {};
      next.artifacts[artifact.artifactId] = artifact;
      break;
    }
    case 'budget_recorded': {
      for (const [key, value] of Object.entries(event.payload?.delta || {})) {
        next.budget[key] = Number(next.budget[key] || 0) + Number(value || 0);
      }
      break;
    }
    case 'remote_heartbeat_recorded': {
      next.remoteHeartbeat = event.payload?.heartbeat || null;
      break;
    }
    case 'run_paused': {
      next.paused = true;
      next.runState = 'paused';
      next.pauseReason = event.payload?.reason || null;
      break;
    }
    case 'run_resumed': {
      next.paused = false;
      next.runState = 'running';
      next.resumeReason = event.payload?.reason || null;
      break;
    }
    case 'run_cancelled': {
      next.cancelled = true;
      next.runState = 'cancelled';
      next.cancelReason = event.payload?.reason || null;
      break;
    }
    case 'blocker_recorded': {
      next.blocker = event.payload?.blocker || null;
      next.runState = 'blocked';
      break;
    }
    default:
      next.lastUnknownEventType = event.type;
  }
  return next;
}

export function projectRuntimeEvents(events = [], { runId = null, generatedAt = null } = {}) {
  const ordered = [...events].sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  const projectionGeneratedAt = generatedAt || ordered.at(-1)?.generatedAt || nowIso();
  let state = defaultState({ runId: runId || ordered[0]?.runId || 'unknown_run', generatedAt: projectionGeneratedAt });
  for (const event of ordered) state = applyEvent(state, event);
  const remoteRunning = state.remoteHeartbeat?.running === true;
  const heartbeatAt = state.remoteHeartbeat?.heartbeatAt || state.remoteHeartbeat?.generatedAt || null;
  state.truth = reduceRunState({
    localRunnerStatus: { running: state.runState === 'running' && !state.cancelled && !state.paused, status: state.runState, generatedAt: state.generatedAt },
    remoteExecutionStatus: state.remoteHeartbeat ? { running: remoteRunning, heartbeatAt, status: state.remoteHeartbeat.status, generatedAt: state.remoteHeartbeat.generatedAt || heartbeatAt } : {},
    blocker: state.blocker,
    completionSummary: state.cancelled ? { stopReason: 'operator_stopped' } : {}
  }, { generatedAt: projectionGeneratedAt });
  return {
    schemaVersion: AGENT_WORK_RUNTIME_PROJECTION_SCHEMA,
    generatedAt: projectionGeneratedAt,
    runId: state.runId,
    eventCount: ordered.length,
    state,
    stateDigest: stateDigest(state)
  };
}

function createSchema(db) {
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runtime_state (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      state_json TEXT NOT NULL,
      state_digest TEXT NOT NULL,
      state_version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      sequence INTEGER PRIMARY KEY,
      event_digest TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      event_json TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      artifact_id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      schema_version TEXT,
      indexed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS leases (
      lease_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      fencing_token INTEGER NOT NULL,
      state TEXT NOT NULL,
      expires_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  const existing = db.prepare('SELECT version FROM migrations WHERE version = ?').get(AGENT_WORK_RUNTIME_DB_SCHEMA_VERSION);
  if (!existing) db.prepare('INSERT INTO migrations(version, applied_at) VALUES (?, ?)').run(AGENT_WORK_RUNTIME_DB_SCHEMA_VERSION, nowIso());
}

function readDbState(db) {
  const row = db.prepare("SELECT state_json FROM runtime_state WHERE id = 'current'").get();
  return row ? JSON.parse(row.state_json) : null;
}

function writeDbState(db, projection) {
  const stateJson = JSON.stringify(projection.state);
  db.prepare(`INSERT INTO runtime_state(id, run_id, state_json, state_digest, state_version, updated_at)
    VALUES ('current', ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id, state_json=excluded.state_json, state_digest=excluded.state_digest, state_version=excluded.state_version, updated_at=excluded.updated_at`).run(
      projection.runId,
      stateJson,
      projection.stateDigest,
      projection.state.stateVersion,
      projection.generatedAt
    );
}

function insertDbEvent(db, event) {
  db.prepare('INSERT INTO events(sequence, event_digest, idempotency_key, event_json, generated_at) VALUES (?, ?, ?, ?, ?)').run(
    event.sequence,
    event.eventDigest,
    event.idempotencyKey,
    JSON.stringify(event),
    event.generatedAt
  );
}

function upsertLease(db, lease) {
  db.prepare(`INSERT INTO leases(lease_id, task_id, worker_id, fencing_token, state, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(lease_id) DO UPDATE SET task_id=excluded.task_id, worker_id=excluded.worker_id, fencing_token=excluded.fencing_token, state=excluded.state, expires_at=excluded.expires_at, updated_at=excluded.updated_at`).run(
      lease.leaseId,
      lease.taskId,
      lease.workerId,
      lease.fencingToken,
      lease.state,
      lease.expiresAt || null,
      lease.updatedAt || lease.acquiredAt || nowIso()
    );
}

function syncDerivedTables(db, projection) {
  for (const lease of Object.values(projection.state.leases || {})) upsertLease(db, lease);
  for (const artifact of Object.values(projection.state.artifacts || {})) {
    db.prepare(`INSERT INTO artifacts(artifact_id, path, sha256, bytes, schema_version, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, sha256=excluded.sha256, bytes=excluded.bytes, schema_version=excluded.schema_version, indexed_at=excluded.indexed_at`).run(
        artifact.artifactId,
        artifact.path,
        artifact.sha256,
        artifact.bytes,
        artifact.schemaVersion || null,
        artifact.indexedAt || nowIso()
      );
  }
}

export function openAgentWorkRuntime({ runRoot, create = true } = {}) {
  if (!runRoot) throw new Error('runRoot is required');
  const root = path.resolve(runRoot);
  ensureDir(root);
  const dbPath = path.join(root, 'run.db');
  const eventsPath = path.join(root, 'run_events.jsonl');
  const db = new DatabaseSync(dbPath);
  if (create) createSchema(db);
  const journal = db.prepare('PRAGMA journal_mode').get();
  return { schemaVersion: AGENT_WORK_RUNTIME_SCHEMA, root, dbPath, eventsPath, db, journalMode: String(journal?.journal_mode || '').toLowerCase() };
}

export function closeAgentWorkRuntime(runtime) {
  runtime?.db?.close?.();
}

function nextSequence(runtime) {
  const row = runtime.db.prepare('SELECT COALESCE(MAX(sequence), 0) AS max_sequence FROM events').get();
  const fileEvents = readJsonLines(runtime.eventsPath);
  const fileMax = fileEvents.reduce((max, event) => Math.max(max, Number(event.sequence || 0)), 0);
  return Math.max(Number(row?.max_sequence || 0), fileMax) + 1;
}

function currentDigest(runtime) {
  const state = readDbState(runtime.db);
  if (state) return stateDigest(state);
  const events = readJsonLines(runtime.eventsPath);
  return projectRuntimeEvents(events).stateDigest;
}

export function appendRuntimeEvent(runtime, eventInput = {}, { faultAt = null } = {}) {
  if (!runtime?.db) throw new Error('runtime is required');
  const idempotencyKey = clean(eventInput.idempotencyKey || `${eventInput.runId}:${eventInput.type}:${sha256(eventInput.payload || {})}`);
  const existing = runtime.db.prepare('SELECT event_json FROM events WHERE idempotency_key = ?').get(idempotencyKey);
  if (existing) return { event: JSON.parse(existing.event_json), duplicate: true, projection: recoverRuntimeState(runtime).projection };
  const event = createEvent({
    sequence: nextSequence(runtime),
    previousDigest: currentDigest(runtime),
    ...eventInput,
    idempotencyKey
  });
  appendJsonLine(runtime.eventsPath, event);
  if (faultAt === 'after_event_append') throw new Error(`fault_injected:${faultAt}`);
  runtime.db.exec('BEGIN IMMEDIATE');
  try {
    insertDbEvent(runtime.db, event);
    if (faultAt === 'after_db_event') throw new Error(`fault_injected:${faultAt}`);
    const events = readJsonLines(runtime.eventsPath);
    const projection = projectRuntimeEvents(events, { runId: event.runId });
    writeDbState(runtime.db, projection);
    syncDerivedTables(runtime.db, projection);
    runtime.db.exec('COMMIT');
    return { event, duplicate: false, projection };
  } catch (error) {
    runtime.db.exec('ROLLBACK');
    throw error;
  }
}

export function recoverRuntimeState(runtimeOrOptions) {
  const runtime = runtimeOrOptions?.db ? runtimeOrOptions : openAgentWorkRuntime(runtimeOrOptions);
  const events = readJsonLines(runtime.eventsPath);
  const projection = projectRuntimeEvents(events);
  runtime.db.exec('BEGIN IMMEDIATE');
  try {
    runtime.db.exec('DELETE FROM events');
    for (const event of events) insertDbEvent(runtime.db, event);
    writeDbState(runtime.db, projection);
    syncDerivedTables(runtime.db, projection);
    runtime.db.exec('COMMIT');
  } catch (error) {
    runtime.db.exec('ROLLBACK');
    throw error;
  }
  writeJson(path.join(runtime.root, 'program_state.json'), projection.state);
  writeJson(path.join(runtime.root, 'run_state_truth.json'), projection.state.truth);
  writeJson(path.join(runtime.root, 'runtime_projection.json'), projection);
  return { ok: true, projection, eventsPath: runtime.eventsPath, dbPath: runtime.dbPath };
}

export function initializeAgentWorkRuntime({ runRoot, runManifest = null, contractBundle = null, generatedAt = nowIso(), faultAt = null } = {}) {
  const runtime = openAgentWorkRuntime({ runRoot });
  const manifest = runManifest || readJsonIfExists(path.join(runtime.root, 'run_manifest.json')) || {};
  const bundle = contractBundle || readJsonIfExists(path.join(runtime.root, 'agent_work_v1_contract_bundle.json')) || {};
  const runId = clean(manifest.runId || bundle.runManifest?.runId || 'agent_work_run');
  appendRuntimeEvent(runtime, {
    type: 'runtime_initialized',
    runId,
    entityType: 'run',
    entityId: runId,
    idempotencyKey: `${runId}:runtime_initialized:v1`,
    generatedAt,
    payload: { runState: manifest.state || 'compiled', runManifest: manifest, contractBundleDigest: sha256(bundle) }
  }, { faultAt });
  for (const task of bundle.taskContracts || []) {
    appendRuntimeEvent(runtime, {
      type: 'task_registered',
      runId,
      entityType: 'task',
      entityId: task.taskId,
      idempotencyKey: `${runId}:${task.taskId}:task_registered:v1`,
      generatedAt,
      payload: { task }
    });
  }
  const recovery = recoverRuntimeState(runtime);
  writeJson(path.join(runtime.root, 'runtime_manifest.json'), {
    schemaVersion: AGENT_WORK_RUNTIME_SCHEMA,
    generatedAt,
    runId,
    dbPath: runtime.dbPath,
    eventsPath: runtime.eventsPath,
    journalMode: runtime.journalMode,
    schemaVersionNumber: AGENT_WORK_RUNTIME_DB_SCHEMA_VERSION,
    truthBoundary: 'Runtime initialization proves durable state setup, not worker execution or completion.'
  });
  return { runtime, recovery };
}

function runtimeState(runtime) {
  return recoverRuntimeState(runtime).projection.state;
}

export function transitionTask(runtime, { taskId, state, expectedStateVersion = null, patchId = null, reason = null, idempotencyKey = null, faultAt = null } = {}) {
  const current = runtimeState(runtime).tasks?.[taskId];
  if (!current) throw new Error(`unknown_task:${taskId}`);
  if (expectedStateVersion != null && Number(current.stateVersion) !== Number(expectedStateVersion)) throw new Error(`state_version_mismatch:${taskId}`);
  const nextVersion = Number(current.stateVersion || 0) + 1;
  return appendRuntimeEvent(runtime, {
    type: 'task_transitioned',
    runId: current.runId,
    entityType: 'task',
    entityId: taskId,
    idempotencyKey: idempotencyKey || `${current.runId}:${taskId}:transition:${state}:${nextVersion}:${patchId || 'no_patch'}`,
    payload: { taskId, state, stateVersion: nextVersion, patchId, reason }
  }, { faultAt });
}

export function acquireLease(runtime, { taskId, workerId, ttlMs = 5 * 60_000, generatedAt = nowIso(), idempotencyKey = null } = {}) {
  const state = runtimeState(runtime);
  const task = state.tasks?.[taskId];
  if (!task) throw new Error(`unknown_task:${taskId}`);
  const activeLease = Object.values(state.leases || {}).find((lease) => lease.taskId === taskId && lease.state === 'active');
  let token = Number(activeLease?.fencingToken || task.activeFencingToken || 0) + 1;
  if (activeLease) {
    appendRuntimeEvent(runtime, {
      type: 'lease_replaced',
      runId: task.runId,
      entityType: 'lease',
      entityId: activeLease.leaseId,
      idempotencyKey: `${task.runId}:${activeLease.leaseId}:lease_replaced:${token}`,
      generatedAt,
      payload: { leaseId: activeLease.leaseId, reason: 'new_lease_acquired' }
    });
  }
  const leaseId = `${taskId}:lease:${token}`;
  const expiresAt = new Date(new Date(generatedAt).getTime() + ttlMs).toISOString();
  return appendRuntimeEvent(runtime, {
    type: 'lease_acquired',
    runId: task.runId,
    entityType: 'lease',
    entityId: leaseId,
    idempotencyKey: idempotencyKey || `${task.runId}:${taskId}:${workerId}:lease:${token}`,
    generatedAt,
    payload: { leaseId, taskId, workerId, fencingToken: token, expiresAt }
  }).projection.state.leases[leaseId];
}

export function assertCurrentLease(runtime, { taskId, leaseId, fencingToken } = {}) {
  const state = runtimeState(runtime);
  const lease = state.leases?.[leaseId];
  if (!lease || lease.taskId !== taskId || lease.state !== 'active' || Number(lease.fencingToken) !== Number(fencingToken)) {
    throw new Error(`stale_fencing_token:${taskId}`);
  }
  return lease;
}

export function stagePatch(runtime, { taskId, leaseId, fencingToken, patchId, artifactPath = null, idempotencyKey = null } = {}) {
  assertCurrentLease(runtime, { taskId, leaseId, fencingToken });
  const current = runtimeState(runtime).tasks[taskId];
  return transitionTask(runtime, {
    taskId,
    state: 'staged',
    expectedStateVersion: current.stateVersion,
    patchId,
    reason: artifactPath ? `patch staged at ${artifactPath}` : 'patch staged',
    idempotencyKey: idempotencyKey || `${current.runId}:${taskId}:patch_staged:${patchId}`
  });
}

export function acceptPatch(runtime, { taskId, leaseId, fencingToken, patchId, idempotencyKey = null } = {}) {
  assertCurrentLease(runtime, { taskId, leaseId, fencingToken });
  const current = runtimeState(runtime).tasks[taskId];
  if (TERMINAL_TASK_STATES.has(current.state) && current.acceptedPatchIds?.includes(patchId)) {
    return { duplicate: true, projection: recoverRuntimeState(runtime).projection };
  }
  return transitionTask(runtime, {
    taskId,
    state: 'accepted',
    expectedStateVersion: current.stateVersion,
    patchId,
    reason: 'independent verification accepted patch',
    idempotencyKey: idempotencyKey || `${current.runId}:${taskId}:patch_accepted:${patchId}`
  });
}

export function indexArtifact(runtime, { artifactId, filePath, schemaVersion = null, idempotencyKey = null } = {}) {
  if (!artifactId) throw new Error('artifactId is required');
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`artifact_missing:${filePath}`);
  const bytes = fs.statSync(filePath).size;
  const digest = sha256(fs.readFileSync(filePath));
  const state = runtimeState(runtime);
  const runId = state.runId;
  const artifact = { artifactId, path: path.resolve(filePath), sha256: digest, bytes, schemaVersion, indexedAt: nowIso() };
  return appendRuntimeEvent(runtime, {
    type: 'artifact_indexed',
    runId,
    entityType: 'artifact',
    entityId: artifactId,
    idempotencyKey: idempotencyKey || `${runId}:artifact:${artifactId}:${digest}`,
    payload: { artifact }
  });
}

export function recordBudget(runtime, { delta = {}, idempotencyKey = null } = {}) {
  const state = runtimeState(runtime);
  return appendRuntimeEvent(runtime, {
    type: 'budget_recorded',
    runId: state.runId,
    entityType: 'budget',
    entityId: 'budget',
    idempotencyKey: idempotencyKey || `${state.runId}:budget:${sha256(delta)}`,
    payload: { delta }
  });
}

export function recordRemoteHeartbeat(runtime, { heartbeat = {}, idempotencyKey = null } = {}) {
  const state = runtimeState(runtime);
  const payload = { heartbeat: { generatedAt: nowIso(), ...heartbeat } };
  return appendRuntimeEvent(runtime, {
    type: 'remote_heartbeat_recorded',
    runId: state.runId,
    entityType: 'remote_execution',
    entityId: 'remote_execution',
    idempotencyKey: idempotencyKey || `${state.runId}:remote_heartbeat:${payload.heartbeat.heartbeatAt || payload.heartbeat.generatedAt}`,
    payload
  });
}

export function pauseRuntime(runtime, { reason = 'operator pause', idempotencyKey = null } = {}) {
  const state = runtimeState(runtime);
  return appendRuntimeEvent(runtime, {
    type: 'run_paused',
    runId: state.runId,
    entityType: 'run',
    entityId: state.runId,
    idempotencyKey: idempotencyKey || `${state.runId}:pause:${sha256(reason)}`,
    payload: { reason }
  });
}

export function resumeRuntime(runtime, { reason = 'operator resume', idempotencyKey = null } = {}) {
  const state = runtimeState(runtime);
  if (state.cancelled) throw new Error('cannot_resume_cancelled_run');
  return appendRuntimeEvent(runtime, {
    type: 'run_resumed',
    runId: state.runId,
    entityType: 'run',
    entityId: state.runId,
    idempotencyKey: idempotencyKey || `${state.runId}:resume:${sha256(reason)}`,
    payload: { reason }
  });
}

export function cancelRuntime(runtime, { reason = 'operator cancellation', idempotencyKey = null } = {}) {
  const state = runtimeState(runtime);
  return appendRuntimeEvent(runtime, {
    type: 'run_cancelled',
    runId: state.runId,
    entityType: 'run',
    entityId: state.runId,
    idempotencyKey: idempotencyKey || `${state.runId}:cancel:${sha256(reason)}`,
    payload: { reason }
  });
}

export function writeRuntimeBlocker(runtime, { family = 'unknown', code, summary, observedEvidence = [], reproductionSteps = [], nextAction, retryable = true, terminal = false } = {}) {
  const state = runtimeState(runtime);
  const blocker = {
    schemaVersion: 'clawd.agent_work.blocker.v1',
    blockerId: `${state.runId}:${code}:runtime`,
    runId: state.runId,
    family,
    code,
    summary,
    observedEvidence,
    reproductionSteps,
    nextAction,
    retryable,
    terminal,
    generatedAt: nowIso()
  };
  writeJson(path.join(runtime.root, 'blocker_report.json'), blocker);
  return appendRuntimeEvent(runtime, {
    type: 'blocker_recorded',
    runId: state.runId,
    entityType: 'blocker',
    entityId: blocker.blockerId,
    idempotencyKey: `${state.runId}:blocker:${code}`,
    payload: { blocker }
  });
}

export function recoverStaleLeases(runtime, { now = nowIso() } = {}) {
  const state = runtimeState(runtime);
  const nowMs = new Date(now).getTime();
  const expired = [];
  for (const lease of Object.values(state.leases || {})) {
    const expiresMs = new Date(lease.expiresAt || 0).getTime();
    if (lease.state === 'active' && Number.isFinite(expiresMs) && expiresMs <= nowMs) {
      expired.push(lease);
      appendRuntimeEvent(runtime, {
        type: 'lease_expired',
        runId: state.runId,
        entityType: 'lease',
        entityId: lease.leaseId,
        idempotencyKey: `${state.runId}:${lease.leaseId}:expired`,
        generatedAt: now,
        payload: { leaseId: lease.leaseId, reason: 'stale_lease_recovered' }
      });
    }
  }
  return { expired, projection: recoverRuntimeState(runtime).projection };
}

export function reconcileRemoteHeartbeat(runtime, { staleAfterMs = 5 * 60_000, generatedAt = nowIso() } = {}) {
  const state = runtimeState(runtime);
  const heartbeat = state.remoteHeartbeat;
  if (!heartbeat || heartbeat.running !== true) return { ok: true, blocked: false, state };
  const heartbeatAt = heartbeat.heartbeatAt || heartbeat.generatedAt;
  const age = Date.parse(generatedAt) - Date.parse(heartbeatAt || 0);
  if (!heartbeatAt || !Number.isFinite(age) || age > staleAfterMs || heartbeat.unknown === true) {
    const result = writeRuntimeBlocker(runtime, {
      family: 'infrastructure',
      code: 'unknown_remote_state',
      summary: 'Remote execution state is unknown or stale; Agent Work must block instead of fabricating completion.',
      observedEvidence: [`heartbeatAt=${heartbeatAt || 'missing'}`, `ageMs=${Number.isFinite(age) ? age : 'unknown'}`, `staleAfterMs=${staleAfterMs}`],
      reproductionSteps: ['Record a running remote heartbeat, wait beyond staleAfterMs, then reconcile.'],
      nextAction: 'Recover or inspect the execution plane before resuming this run.',
      retryable: true,
      terminal: false
    });
    return { ok: false, blocked: true, blocker: result.projection.state.blocker, projection: result.projection };
  }
  return { ok: true, blocked: false, state };
}

export function backupRuntime({ runRoot, backupPath } = {}) {
  const runtime = openAgentWorkRuntime({ runRoot });
  const target = path.resolve(backupPath || path.join(runtime.root, 'run.db.backup'));
  ensureDir(path.dirname(target));
  runtime.db.exec('PRAGMA wal_checkpoint(FULL)');
  fs.copyFileSync(runtime.dbPath, target);
  closeAgentWorkRuntime(runtime);
  return { backupPath: target, sha256: sha256(fs.readFileSync(target)), bytes: fs.statSync(target).size };
}

export function buildRecoveryQualificationPacket({ runRoot, generatedAt = nowIso(), checks = {} } = {}) {
  const runtime = openAgentWorkRuntime({ runRoot });
  const recovery = recoverRuntimeState(runtime);
  const migrations = runtime.db.prepare('SELECT version, applied_at FROM migrations ORDER BY version').all();
  const packet = {
    schemaVersion: AGENT_WORK_RUNTIME_RECOVERY_PACKET_SCHEMA,
    generatedAt,
    runId: recovery.projection.runId,
    artifactRoot: runtime.root,
    dbPath: runtime.dbPath,
    eventsPath: runtime.eventsPath,
    journalMode: runtime.journalMode,
    migrationVersions: migrations.map((row) => row.version),
    eventCount: recovery.projection.eventCount,
    stateDigest: recovery.projection.stateDigest,
    acceptedPatchIds: recovery.projection.state.acceptedPatchIds,
    taskStates: Object.fromEntries(Object.entries(recovery.projection.state.tasks || {}).map(([id, task]) => [id, task.state])),
    checks,
    truth: recovery.projection.state.truth,
    truthBoundary: 'Phase 3 recovery packet proves durable runtime state mechanics for the supplied run root. It does not prove worker implementation quality or release completion.'
  };
  const packetPath = writeJson(path.join(runtime.root, 'recovery_qualification_packet.json'), packet);
  closeAgentWorkRuntime(runtime);
  return { packet, packetPath };
}
