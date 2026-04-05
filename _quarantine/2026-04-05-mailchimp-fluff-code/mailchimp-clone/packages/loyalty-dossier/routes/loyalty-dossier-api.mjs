import { buildLoyaltyDossierSnapshot, createLoyaltyDossierApiDocument } from '../service-loyalty-dossier.mjs';

export function createLoyaltyDossierApiRoutes(basePath = '/api/loyalty-dossier') {
  const snapshot = buildLoyaltyDossierSnapshot();
  return [
    { id: 'loyalty-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-dossier.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyDossierApiDocument(snapshot) }
  ];
}

