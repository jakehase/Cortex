import { persistState } from './storage.mjs';
import { recordEvent } from './domain-core.mjs';
import { createId } from './utils.mjs';
import { executeJobByType } from './job-handlers.mjs';

export const JOBS_OPERATIONAL_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'persistence_jobs_operational_runtime_layer',
  label: 'Persistence, background jobs, and operational queue runtime',
  controls: [
    'durable_job_queue_state',
    'retry_backoff_and_attempt_history',
    'dead_letter_requeue_workflow',
    'job_operational_snapshot_api',
    'worker_heartbeat_ledger'
  ]
});

const DEFAULT_JOB_ATTEMPTS = {
  import_contacts: 2,
  send_test_campaign: 2,
  deliver_campaign: 2
};

function now() {
  return new Date().toISOString();
}

function scheduleRetry(job) {
  const delayMs = Number(job.retryDelayMs || 250);
  job.runAt = new Date(Date.now() + delayMs).toISOString();
}

function appendHistory(job, status, detail = '') {
  job.history ||= [];
  job.history.unshift({ at: now(), status, detail, attempt: job.attempts || 0 });
}

export function ensureJobOperationalCollections(state) {
  state.db ||= {};
  state.db.jobs ||= [];
  state.db.jobDeadLetters ||= [];
  state.db.jobQueueLeases ||= [];
  state.db.jobOperationalSnapshots ||= [];
  state.db.jobServiceHeartbeats ||= [];
  state.db.jobIdempotencyKeys ||= [];
  return state.db;
}

function summarizeJobs(jobs = []) {
  const byStatus = { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  const byType = {};
  for (const job of jobs) {
    const status = ['pending', 'running', 'completed', 'failed', 'cancelled'].includes(job.status) ? job.status : 'pending';
    byStatus[status] = (byStatus[status] || 0) + 1;
    byType[job.type] = (byType[job.type] || 0) + 1;
  }
  return { byStatus, byType, total: jobs.length };
}

export function buildJobOperationalSnapshot(state, workspaceId = null) {
  ensureJobOperationalCollections(state);
  const jobs = workspaceId ? state.db.jobs.filter((job) => job.workspaceId === workspaceId) : state.db.jobs;
  const deadLetters = workspaceId ? state.db.jobDeadLetters.filter((entry) => entry.workspaceId === workspaceId) : state.db.jobDeadLetters;
  const leases = workspaceId ? state.db.jobQueueLeases.filter((entry) => entry.workspaceId === workspaceId) : state.db.jobQueueLeases;
  const nowMs = Date.now();
  const dueJobs = jobs.filter((job) => job.status === 'pending' && new Date(job.runAt || job.createdAt || 0).getTime() <= nowMs);
  const futurePending = jobs.filter((job) => job.status === 'pending' && new Date(job.runAt || job.createdAt || 0).getTime() > nowMs);
  return {
    ...JOBS_OPERATIONAL_RUNTIME_CONTRACT,
    generatedAt: now(),
    workspaceId,
    queue: {
      ...summarizeJobs(jobs),
      dueCount: dueJobs.length,
      nextDueAt: futurePending.map((job) => job.runAt || job.createdAt).filter(Boolean).sort()[0] || null,
      deadLetterCount: deadLetters.length,
      retryableDeadLetterCount: deadLetters.filter((entry) => !entry.requeuedAt).length
    },
    leases: {
      active: leases.filter((lease) => lease.status === 'active'),
      stale: leases.filter((lease) => lease.status === 'active' && new Date(lease.expiresAt || 0).getTime() <= nowMs),
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
      error: job.error || null,
      history: (job.history || []).slice(0, 5)
    })),
    deadLetters: deadLetters.slice(0, 20),
    heartbeats: state.db.jobServiceHeartbeats.slice(0, 10),
    idempotencyKeys: state.db.jobIdempotencyKeys.filter((entry) => !workspaceId || entry.workspaceId === workspaceId).slice(0, 10)
  };
}

export function recordJobServiceHeartbeat(state, { workerId = 'mailclone-in-process-worker', status = 'running', detail = 'job runtime heartbeat' } = {}) {
  ensureJobOperationalCollections(state);
  const heartbeat = { id: createId('jobhb'), workerId, status, detail, createdAt: now(), pendingJobCount: state.db.jobs.filter((job) => job.status === 'pending').length };
  state.db.jobServiceHeartbeats.unshift(heartbeat);
  state.db.jobServiceHeartbeats = state.db.jobServiceHeartbeats.slice(0, 50);
  persistState(state);
  return heartbeat;
}

export function requeueDeadLetterJob(state, actor, deadLetterId, { runAt = now() } = {}) {
  ensureJobOperationalCollections(state);
  const workspaceId = actor?.workspace?.id || actor?.workspaceId || null;
  const deadLetter = state.db.jobDeadLetters.find((entry) => entry.id === deadLetterId && (!workspaceId || entry.workspaceId === workspaceId));
  if (!deadLetter) return null;
  const job = {
    id: createId('job'),
    type: deadLetter.type,
    workspaceId: deadLetter.workspaceId,
    userId: actor?.user?.id || deadLetter.userId || '',
    payload: deadLetter.payload || {},
    status: 'pending',
    createdAt: now(),
    updatedAt: now(),
    runAt,
    attempts: 0,
    maxAttempts: Math.max(1, Number(deadLetter.attempts || DEFAULT_JOB_ATTEMPTS[deadLetter.type] || 1)),
    retryDelayMs: 250,
    requeuedFromDeadLetterId: deadLetter.id,
    history: [{ at: now(), status: 'requeued', detail: `Requeued from dead letter ${deadLetter.id}`, attempt: 0 }]
  };
  state.db.jobs.unshift(job);
  deadLetter.requeuedAt = now();
  deadLetter.requeuedJobId = job.id;
  recordEvent(state, { workspaceId: job.workspaceId, type: 'job-dead-letter-requeued', message: `${deadLetter.type} requeued`, meta: { deadLetterId, jobId: job.id } });
  state.db.jobOperationalSnapshots.unshift({ id: createId('jobsnap'), reason: 'dead_letter_requeued', ...buildJobOperationalSnapshot(state, job.workspaceId) });
  state.db.jobOperationalSnapshots = state.db.jobOperationalSnapshots.slice(0, 50);
  persistState(state);
  return job;
}

export function runJobs(state) {
  ensureJobOperationalCollections(state);
  let changed = false;
  for (const job of state.db.jobs) {
    if (job.status !== 'pending') continue;
    if (new Date(job.runAt || job.createdAt).getTime() > Date.now()) continue;
    changed = true;
    job.maxAttempts ||= DEFAULT_JOB_ATTEMPTS[job.type] || 1;
    job.retryDelayMs ||= 250;
    job.attempts = Number(job.attempts || 0) + 1;
    job.status = 'running';
    job.startedAt ||= now();
    job.lastAttemptAt = now();
    job.lockedAt = job.lastAttemptAt;
    job.updatedAt = job.lastAttemptAt;
    appendHistory(job, 'running', `${job.type} started`);
    try {
      executeJobByType(state, job);
      job.status = 'completed';
      job.completedAt = now();
      job.updatedAt = job.completedAt;
      job.lockedAt = null;
      appendHistory(job, 'completed', `${job.type} completed`);
      recordEvent(state, { workspaceId: job.workspaceId, type: 'job-complete', message: `${job.type} completed`, meta: { jobId: job.id, attempts: job.attempts } });
    } catch (error) {
      job.error = error.message;
      job.updatedAt = now();
      job.lockedAt = null;
      if (job.attempts < job.maxAttempts) {
        scheduleRetry(job);
        job.status = 'pending';
        appendHistory(job, 'retry_scheduled', `${job.type} retry ${job.attempts}/${job.maxAttempts}: ${error.message}`);
        recordEvent(state, { workspaceId: job.workspaceId, type: 'job-retry', level: 'warn', message: `${job.type} retry scheduled: ${error.message}`, meta: { jobId: job.id, attempts: job.attempts, maxAttempts: job.maxAttempts, retryAt: job.runAt } });
      } else {
        job.status = 'failed';
        job.failedAt = now();
        appendHistory(job, 'failed', `${job.type} failed after ${job.attempts} attempts: ${error.message}`);
        state.db.jobDeadLetters.unshift({ id: `${job.id}_dead`, jobId: job.id, workspaceId: job.workspaceId, type: job.type, error: error.message, attempts: job.attempts, failedAt: job.failedAt, payload: job.payload });
        recordEvent(state, { workspaceId: job.workspaceId, type: 'job-failed', level: 'error', message: `${job.type} failed: ${error.message}`, meta: { jobId: job.id, attempts: job.attempts } });
      }
    }
  }
  if (changed) persistState(state);
}
