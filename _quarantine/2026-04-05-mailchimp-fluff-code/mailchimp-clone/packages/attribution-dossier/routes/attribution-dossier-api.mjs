import { buildAttributionDossierSnapshot, createAttributionDossierApiDocument } from '../service-attribution-dossier.mjs';

export function createAttributionDossierApiRoutes(basePath = '/api/attribution-dossier') {
  const snapshot = buildAttributionDossierSnapshot();
  return [
    { id: 'attribution-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-dossier.api.document', method: 'GET', path: basePath + '/document', document: createAttributionDossierApiDocument(snapshot) }
  ];
}

