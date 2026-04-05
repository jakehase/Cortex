import { buildCampaignAtlasSnapshot, createCampaignAtlasRouteSummary } from '../service-campaign-atlas.mjs';

export function createCampaignAtlasDashboardRoutes(basePath = '/campaign-atlas') {
  const snapshot = buildCampaignAtlasSnapshot();
  return [
    { id: 'campaign-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignAtlasRouteSummary(snapshot) },
    { id: 'campaign-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

