import { buildCampaignDossierSnapshot, createCampaignDossierApiDocument } from '../service-campaign-dossier.mjs';

export function createCampaignDossierApiRoutes(basePath = '/api/campaign-dossier') {
  const snapshot = buildCampaignDossierSnapshot();
  return [
    { id: 'campaign-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-dossier.api.document', method: 'GET', path: basePath + '/document', document: createCampaignDossierApiDocument(snapshot) }
  ];
}

