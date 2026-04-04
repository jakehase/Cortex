import { buildCampaignAdvisorSnapshot, createCampaignAdvisorRouteSummary } from '../service-campaign-advisor.mjs';

export function createCampaignAdvisorDashboardRoutes(basePath = '/campaign-advisor') {
  const snapshot = buildCampaignAdvisorSnapshot();
  return [
    { id: 'campaign-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignAdvisorRouteSummary(snapshot) },
    { id: 'campaign-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

