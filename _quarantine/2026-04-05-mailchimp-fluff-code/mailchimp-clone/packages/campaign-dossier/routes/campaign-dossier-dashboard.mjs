import { buildCampaignDossierSnapshot, createCampaignDossierRouteSummary } from '../service-campaign-dossier.mjs';

export function createCampaignDossierDashboardRoutes(basePath = '/campaign-dossier') {
  const snapshot = buildCampaignDossierSnapshot();
  return [
    { id: 'campaign-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignDossierRouteSummary(snapshot) },
    { id: 'campaign-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

