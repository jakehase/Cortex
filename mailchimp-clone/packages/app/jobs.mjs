import { persistState } from './storage.mjs';
import { recordEvent } from './domain-core.mjs';
import { createId, nowIso } from './utils.mjs';
import { executeJobByType } from './job-handlers.mjs';

export const JOBS_OPERATIONAL_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'persistence_jobs_operational_runtime_layer',
  label: 'Persistence, background jobs, and operational queue runtime',
  controls: [
    'durable_job_queue_state',
    'worker_lease_and_heartbeat_ledger',
    'retry_backoff_and_attempt_history',
    'dead_letter_requeue_workflow',
    'job_operational_snapshot_api',
    'storage_runtime_coupled_with_job_queue'
  ],
  evidenceContract: [
    'pending_running_completed_failed_counts',
    'job_attempt_history',
    'active_and_released_leases',
    'worker_service_heartbeats',
    'dead_letter_records_and_requeues',
    'admin_route_and_json_api_evidence'
  ]
});

const DEFAULT_JOB_ATTEMPTS = {
  import_contacts: 2,
  send_test_campaign: 2,
  deliver_campaign: 2,
  audience_provider_sync: 2,
  segment_refresh: 2,
  lead_capture_publish_handoff: 2,
  onboarding_recovery: 2
};

const DEFAULT_LEASE_TTL_MS = Number(process.env.MAILCLONE_JOB_LEASE_TTL_MS || 1000 * 60 * 5);
const DEFAULT_RETRY_DELAY_MS = Number(process.env.MAILCLONE_JOB_RETRY_DELAY_MS || 250);

function now() {
  return nowIso();
}

export function ensureJobOperationalCollections(state) {
  state.db.jobs ||= [];
  state.db.jobDeadLetters ||= [];
  state.db.jobQueueLeases ||= [];
  state.db.jobOperationalSnapshots ||= [];
  state.db.jobServiceHeartbeats ||= [];
  state.db.jobIdempotencyKeys ||= [];
}

function scheduleRetry(job) {
  const delayMs = Number(job.retryDelayMs || DEFAULT_RETRY_DELAY_MS);
  job.runAt = new Date(Date.now() + delayMs).toISOString();
}

function appendHistory(job, status, detail = '', extra = {}) {
  job.history ||= [];
  job.history.unshift({ id: createId('jobhist'), at: now(), status, detail, attempt: job.attempts || 0, ...extra });
  job.history = job.history.slice(0, 50);
}

function statusBucket(job) {
  if (job.status === 'completed') return 'completed';
  if (job.status === 'failed') return 'failed';
  if (job.status === 'running') return 'running';
  if (job.status === 'cancelled') return 'cancelled';
  return 'pending';
}

function summarizeJobs(jobs = []) {
  const byStatus = { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  const byType = {};
  for (const job of jobs) {
    byStatus[statusBucket(job)] = (byStatus[statusBucket(job)] || 0) + 1;
    byType[job.type] = (byType[job.type] || 0) + 1;
  }
  return { byStatus, byType, total: jobs.length };
}

function activeLeases(state) {
  const nowMs = Date.now();
  return state.db.jobQueueLeases.filter((lease) => lease.status === 'active' && new Date(lease.expiresAt).getTime() > nowMs);
}

function staleLeases(state) {
  const nowMs = Date.now();
  return state.db.jobQueueLeases.filter((lease) => lease.status === 'active' && new Date(lease.expiresAt).getTime() <= nowMs);
}

function acquireJobLease(state, job, { workerId = 'mailclone-in-process-worker' } = {}) {
  ensureJobOperationalCollections(state);
  const priorActive = activeLeases(state).find((lease) => lease.jobId === job.id);
  if (priorActive) return { ok: false, lease: priorActive, reason: 'job_already_leased' };
  const lease = {
    id: createId('lease'),
    jobId: job.id,
    workspaceId: job.workspaceId,
    workerId,
    status: 'active',
    acquiredAt: now(),
    expiresAt: new Date(Date.now() + DEFAULT_LEASE_TTL_MS).toISOString(),
    releasedAt: null,
    releaseReason: null,
    attempt: Number(job.attempts || 0) + 1
  };
  state.db.jobQueueLeases.unshift(lease);
  job.leaseId = lease.id;
  job.workerId = workerId;
  return { ok: true, lease };
}

function releaseJobLease(state, lease, reason) {
  if (!lease) return;
  lease.status = reason === 'completed' ? 'released_completed' : reason === 'failed' ? 'released_failed' : 'released';
  lease.releasedAt = now();
  lease.releaseReason = reason;
}

function appendOperationalSnapshot(state, workspaceId = null, reason = 'job_runtime') {
  const snapshot = buildJobOperationalSnapshot(state, workspaceId);
  state.db.jobOperationalSnapshots.unshift({ id: createId('jobsnap'), reason, ...snapshot });
  state.db.jobOperationalSnapshots = state.db.jobOperationalSnapshots.slice(0, 50);
  return snapshot;
}

export function recordJobServiceHeartbeat(state, { workerId = 'mailclone-in-process-worker', status = 'running', detail = 'job runtime heartbeat' } = {}) {
  ensureJobOperationalCollections(state);
  const heartbeat = {
    id: createId('jobhb'),
    workerId,
    status,
    detail,
    activeLeaseCount: activeLeases(state).length,
    pendingJobCount: state.db.jobs.filter((job) => job.status === 'pending').length,
    createdAt: now()
  };
  state.db.jobServiceHeartbeats.unshift(heartbeat);
  state.db.jobServiceHeartbeats = state.db.jobServiceHeartbeats.slice(0, 50);
  persistState(state);
  return heartbeat;
}

export function buildJobOperationalSnapshot(state, workspaceId = null) {
  ensureJobOperationalCollections(state);
  const jobs = workspaceId ? state.db.jobs.filter((job) => job.workspaceId === workspaceId) : state.db.jobs;
  const deadLetters = workspaceId ? state.db.jobDeadLetters.filter((entry) => entry.workspaceId === workspaceId) : state.db.jobDeadLetters;
  const leases = workspaceId ? state.db.jobQueueLeases.filter((lease) => lease.workspaceId === workspaceId) : state.db.jobQueueLeases;
  const dueJobs = jobs.filter((job) => job.status === 'pending' && new Date(job.runAt || job.createdAt).getTime() <= Date.now());
  const futurePending = jobs.filter((job) => job.status === 'pending' && new Date(job.runAt || job.createdAt).getTime() > Date.now());
  const nextDueAt = futurePending.map((job) => job.runAt || job.createdAt).sort()[0] || null;
  const summary = summarizeJobs(jobs);
  return {
    ...JOBS_OPERATIONAL_RUNTIME_CONTRACT,
    generatedAt: now(),
    workspaceId,
    queue: {
      ...summary,
      dueCount: dueJobs.length,
      nextDueAt,
      deadLetterCount: deadLetters.length,
      retryableDeadLetterCount: deadLetters.filter((entry) => !entry.requeuedAt).length
    },
    leases: {
      active: leases.filter((lease) => lease.status === 'active'),
      stale: staleLeases({ db: { jobQueueLeases: leases } }),
      recent: leases.slice(0, 20)
    },
    recentJobs: jobs.slice(0, 20).map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts || 0,
      maxAttempts: job.maxAttempts || DEFAULT_JOB_ATTEMPTS[job.type] || 1,
      runAt: job.runAt,
      updatedAt: job.updatedAt,
      leaseId: job.leaseId || null,
      error: job.error || null,
      history: (job.history || []).slice(0, 5)
    })),
    deadLetters: deadLetters.slice(0, 20),
    heartbeats: state.db.jobServiceHeartbeats.slice(0, 10),
    idempotencyKeys: state.db.jobIdempotencyKeys.filter((entry) => !workspaceId || entry.workspaceId === workspaceId).slice(0, 10)
  };
}

export function requeueDeadLetterJob(state, actor, deadLetterId, { runAt = now() } = {}) {
  ensureJobOperationalCollections(state);
  const deadLetter = state.db.jobDeadLetters.find((entry) => entry.id === deadLetterId && entry.workspaceId === actor.workspace.id);
  if (!deadLetter) return null;
  const job = {
    id: createId('job'),
    type: deadLetter.type,
    workspaceId: deadLetter.workspaceId,
    userId: actor.user.id,
    payload: deadLetter.payload || {},
    status: 'pending',
    createdAt: now(),
    updatedAt: now(),
    runAt,
    result: null,
    attempts: 0,
    maxAttempts: Math.max(1, Number(deadLetter.attempts || 1)),
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    requeuedFromDeadLetterId: deadLetter.id,
    history: [{ id: createId('jobhist'), at: now(), status: 'requeued', detail: `Requeued from dead letter ${deadLetter.id}`, attempt: 0 }]
  };
  state.db.jobs.unshift(job);
  deadLetter.requeuedAt = now();
  deadLetter.requeuedJobId = job.id;
  recordEvent(state, { workspaceId: actor.workspace.id, type: 'job-dead-letter-requeued', message: `${deadLetter.type} requeued`, meta: { deadLetterId, jobId: job.id } });
  appendOperationalSnapshot(state, actor.workspace.id, 'dead_letter_requeued');
  persistState(state);
  return job;
}

export function runJobs(state, { workerId = 'mailclone-in-process-worker' } = {}) {
  ensureJobOperationalCollections(state);
  let changed = false;
  for (const lease of staleLeases(state)) {
    lease.status = 'expired';
    lease.expiredAt = now();
    lease.releaseReason = 'lease_expired';
    changed = true;
  }
  for (const job of state.db.jobs) {
    if (job.status !== 'pending') continue;
    if (new Date(job.runAt || job.createdAt).getTime() > Date.now()) continue;
    const leaseResult = acquireJobLease(state, job, { workerId });
    if (!leaseResult.ok) continue;
    const lease = leaseResult.lease;
    changed = true;
    job.maxAttempts ||= DEFAULT_JOB_ATTEMPTS[job.type] || 1;
    job.retryDelayMs ||= DEFAULT_RETRY_DELAY_MS;
    job.attempts = Number(job.attempts || 0) + 1;
    job.status = 'running';
    job.startedAt ||= now();
    job.lastAttemptAt = now();
    job.lockedAt = job.lastAttemptAt;
    job.updatedAt = job.lastAttemptAt;
    appendHistory(job, 'running', `${job.type} started`, { leaseId: lease.id, workerId });
    try {
      executeJobByType(state, job);
      job.status = 'completed';
      job.completedAt = now();
      job.updatedAt = job.completedAt;
      job.lockedAt = null;
      releaseJobLease(state, lease, 'completed');
      appendHistory(job, 'completed', `${job.type} completed`, { leaseId: lease.id });
      recordEvent(state, { workspaceId: job.workspaceId, type: 'job-complete', message: `${job.type} completed`, meta: { jobId: job.id, attempts: job.attempts, leaseId: lease.id } });
    } catch (error) {
      job.error = error.message;
      job.updatedAt = now();
      job.lockedAt = null;
      if (job.attempts < job.maxAttempts) {
        releaseJobLease(state, lease, 'retry_scheduled');
        scheduleRetry(job);
        job.status = 'pending';
        appendHistory(job, 'retry_scheduled', `${job.type} retry ${job.attempts}/${job.maxAttempts}: ${error.message}`, { leaseId: lease.id });
        recordEvent(state, { workspaceId: job.workspaceId, type: 'job-retry', level: 'warn', message: `${job.type} retry scheduled: ${error.message}`, meta: { jobId: job.id, attempts: job.attempts, maxAttempts: job.maxAttempts, retryAt: job.runAt, leaseId: lease.id } });
      } else {
        releaseJobLease(state, lease, 'failed');
        job.status = 'failed';
        job.failedAt = now();
        appendHistory(job, 'failed', `${job.type} failed after ${job.attempts} attempts: ${error.message}`, { leaseId: lease.id });
        state.db.jobDeadLetters.unshift({ id: createId('deadjob'), jobId: job.id, workspaceId: job.workspaceId, type: job.type, error: error.message, attempts: job.attempts, failedAt: job.failedAt, payload: job.payload, history: job.history || [], leaseId: lease.id });
        recordEvent(state, { workspaceId: job.workspaceId, type: 'job-failed', level: 'error', message: `${job.type} failed: ${error.message}`, meta: { jobId: job.id, attempts: job.attempts, leaseId: lease.id } });
      }
    }
  }
  if (changed) {
    appendOperationalSnapshot(state, null, 'run_jobs');
    persistState(state);
  }
}
