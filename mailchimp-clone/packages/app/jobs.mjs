import { saveDb } from './storage.mjs';
import { createNotification, recordEvent } from './domain-core.mjs';
import { processCsvImport } from './domain-audience.mjs';
import { campaignHtml, markCampaignDelivered } from './domain-campaigns.mjs';

export function runJobs(state) {
  let changed = false;
  for (const job of state.db.jobs) {
    if (job.status !== 'pending') continue;
    if (new Date(job.runAt).getTime() > Date.now()) continue;
    changed = true;
    job.status = 'running';
    job.updatedAt = new Date().toISOString();
    try {
      if (job.type === 'import_contacts') {
        job.result = processCsvImport(state, job);
        createNotification(state, { workspaceId: job.workspaceId, type: 'import-complete', payload: { audienceId: job.payload.audienceId, ...job.result } });
      }
      if (job.type === 'send_test_campaign') {
        const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);
        job.result = createNotification(state, { workspaceId: job.workspaceId, type: 'test-send', payload: { campaignId: campaign.id, to: job.payload.testEmail, subject: campaign.subject, htmlPreview: campaignHtml(campaign, state) } });
      }
      if (job.type === 'deliver_campaign') {
        const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);
        job.result = markCampaignDelivered(state, campaign);
      }
      job.status = 'completed';
      job.updatedAt = new Date().toISOString();
      recordEvent(state, { workspaceId: job.workspaceId, type: 'job-complete', message: `${job.type} completed`, meta: { jobId: job.id } });
    } catch (error) {
      job.status = 'failed';
      job.updatedAt = new Date().toISOString();
      job.error = error.message;
      recordEvent(state, { workspaceId: job.workspaceId, type: 'job-failed', level: 'error', message: `${job.type} failed: ${error.message}`, meta: { jobId: job.id } });
    }
  }
  if (changed) saveDb(state.db);
}
