import { buildAdvocacyDossierSnapshot, createAdvocacyDossierApiDocument } from '../service-advocacy-dossier.mjs';

export function createAdvocacyDossierApiRoutes(basePath = '/api/advocacy-dossier') {
  const snapshot = buildAdvocacyDossierSnapshot();
  return [
    { id: 'advocacy-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-dossier.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyDossierApiDocument(snapshot) }
  ];
}

