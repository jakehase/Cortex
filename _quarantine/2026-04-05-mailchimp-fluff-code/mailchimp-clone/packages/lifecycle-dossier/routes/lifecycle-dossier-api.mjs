import { buildLifecycleDossierSnapshot, createLifecycleDossierApiDocument } from '../service-lifecycle-dossier.mjs';

export function createLifecycleDossierApiRoutes(basePath = '/api/lifecycle-dossier') {
  const snapshot = buildLifecycleDossierSnapshot();
  return [
    { id: 'lifecycle-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-dossier.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleDossierApiDocument(snapshot) }
  ];
}

