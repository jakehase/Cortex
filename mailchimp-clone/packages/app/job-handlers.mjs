import { createNotification, recordEvent } from './domain-core.mjs';
import { processCsvImport } from './domain-audience.mjs';
import { campaignHtml, markCampaignDelivered } from './domain-campaigns.mjs';

export const JOB_HANDLERS = {
  import_contacts(state, job) {
    job.result = processCsvImport(state, job);
    createNotification(state, { workspaceId: job.workspaceId, type: 'import-complete', payload: { audienceId: job.payload.audienceId, ...job.result } });
  },
  send_test_campaign(state, job) {
    const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);
    if (!campaign) throw new Error(`Campaign ${job.payload.campaignId} not found for test send`);
    job.result = createNotification(state, { workspaceId: job.workspaceId, type: 'test-send', payload: { campaignId: campaign.id, to: job.payload.testEmail, subject: campaign.subject, htmlPreview: campaignHtml(campaign, state) } });
  },
  deliver_campaign(state, job) {
    const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);
    if (!campaign) throw new Error(`Campaign ${job.payload.campaignId} not found for delivery`);
    job.result = markCampaignDelivered(state, campaign);
  }
};

export function executeJobByType(state, job) {
  const handler = JOB_HANDLERS[job.type];
  if (!handler) throw new Error(`Unsupported job type: ${job.type}`);
  return handler(state, job);
}
