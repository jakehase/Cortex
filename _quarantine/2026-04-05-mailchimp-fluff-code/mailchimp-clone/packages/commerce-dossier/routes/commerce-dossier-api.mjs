import { buildCommerceDossierSnapshot, createCommerceDossierApiDocument } from '../service-commerce-dossier.mjs';

export function createCommerceDossierApiRoutes(basePath = '/api/commerce-dossier') {
  const snapshot = buildCommerceDossierSnapshot();
  return [
    { id: 'commerce-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-dossier.api.document', method: 'GET', path: basePath + '/document', document: createCommerceDossierApiDocument(snapshot) }
  ];
}

