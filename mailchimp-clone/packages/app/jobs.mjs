import { saveDb } from './storage.mjs';
import { createNotification, recordEvent } from './domain-core.mjs';
import { processCsvImport } from './domain-audience.mjs';
import { campaignHtml, markCampaignDelivered } from './domain-campaigns.mjs';

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

function executeJob(state, job) {
  if (job.type === 'import_contacts') {
    job.result = processCsvImport(state, job);
    createNotification(state, { workspaceId: job.workspaceId, type: 'import-complete', payload: { audienceId: job.payload.audienceId, ...job.result } });
    return;
  }
  if (job.type === 'send_test_campaign') {
    const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);
    if (!campaign) throw new Error(`Campaign ${job.payload.campaignId} not found for test send`);
    job.result = createNotification(state, { workspaceId: job.workspaceId, type: 'test-send', payload: { campaignId: campaign.id, to: job.payload.testEmail, subject: campaign.subject, htmlPreview: campaignHtml(campaign, state) } });
    return;
  }
  if (job.type === 'deliver_campaign') {
    const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);
    if (!campaign) throw new Error(`Campaign ${job.payload.campaignId} not found for delivery`);
    job.result = markCampaignDelivered(state, campaign);
    return;
  }
  throw new Error(`Unsupported job type: ${job.type}`);
}

export function runJobs(state) {
  state.db.jobDeadLetters ||= [];
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
      executeJob(state, job);
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
  if (changed) saveDb(state.db);
}
