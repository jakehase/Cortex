import { buildAudienceDossierSnapshot, createAudienceDossierApiDocument } from '../service-audience-dossier.mjs';

export function createAudienceDossierApiRoutes(basePath = '/api/audience-dossier') {
  const snapshot = buildAudienceDossierSnapshot();
  return [
    { id: 'audience-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-dossier.api.document', method: 'GET', path: basePath + '/document', document: createAudienceDossierApiDocument(snapshot) }
  ];
}

