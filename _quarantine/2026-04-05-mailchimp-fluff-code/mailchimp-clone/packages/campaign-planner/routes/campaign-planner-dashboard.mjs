import { buildCampaignPlannerSnapshot, createCampaignPlannerRouteSummary } from '../service-campaign-planner.mjs';

export function createCampaignPlannerDashboardRoutes(basePath = '/campaign-planner') {
  const snapshot = buildCampaignPlannerSnapshot();
  return [
    { id: 'campaign-planner.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignPlannerRouteSummary(snapshot) },
    { id: 'campaign-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

