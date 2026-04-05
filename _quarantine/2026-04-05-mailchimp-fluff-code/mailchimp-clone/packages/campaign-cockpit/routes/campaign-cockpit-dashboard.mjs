import { buildCampaignCockpitSnapshot, createCampaignCockpitRouteSummary } from '../service-campaign-cockpit.mjs';

export function createCampaignCockpitDashboardRoutes(basePath = '/campaign-cockpit') {
  const snapshot = buildCampaignCockpitSnapshot();
  return [
    { id: 'campaign-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignCockpitRouteSummary(snapshot) },
    { id: 'campaign-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

