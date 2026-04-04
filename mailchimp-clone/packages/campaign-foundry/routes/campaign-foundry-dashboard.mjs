import { buildCampaignFoundrySnapshot, createCampaignFoundryRouteSummary } from '../service-campaign-foundry.mjs';

export function createCampaignFoundryDashboardRoutes(basePath = '/campaign-foundry') {
  const snapshot = buildCampaignFoundrySnapshot();
  return [
    { id: 'campaign-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignFoundryRouteSummary(snapshot) },
    { id: 'campaign-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

