import { buildCampaignSentinelSnapshot, createCampaignSentinelRouteSummary } from '../service-campaign-sentinel.mjs';

export function createCampaignSentinelDashboardRoutes(basePath = '/campaign-sentinel') {
  const snapshot = buildCampaignSentinelSnapshot();
  return [
    { id: 'campaign-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignSentinelRouteSummary(snapshot) },
    { id: 'campaign-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

