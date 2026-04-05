import { buildContentDossierSnapshot, createContentDossierApiDocument } from '../service-content-dossier.mjs';

export function createContentDossierApiRoutes(basePath = '/api/content-dossier') {
  const snapshot = buildContentDossierSnapshot();
  return [
    { id: 'content-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-dossier.api.document', method: 'GET', path: basePath + '/document', document: createContentDossierApiDocument(snapshot) }
  ];
}

