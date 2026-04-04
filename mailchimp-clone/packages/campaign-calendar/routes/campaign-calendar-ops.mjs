import { buildCampaignCalendarSnapshot, createCampaignCalendarChecklist } from '../service-campaign-calendar.mjs';

export function createCampaignCalendarOpsRoutes(basePath = '/ops/campaign-calendar') {
  const snapshot = buildCampaignCalendarSnapshot();
  return [
    { id: 'campaign-calendar.ops.health', method: 'GET', path: basePath + '/health', checklist: createCampaignCalendarChecklist(snapshot) },
    { id: 'campaign-calendar.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'campaign-calendar.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
