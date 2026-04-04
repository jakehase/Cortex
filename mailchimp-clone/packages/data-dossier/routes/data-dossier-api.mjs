import { buildDataDossierSnapshot, createDataDossierApiDocument } from '../service-data-dossier.mjs';

export function createDataDossierApiRoutes(basePath = '/api/data-dossier') {
  const snapshot = buildDataDossierSnapshot();
  return [
    { id: 'data-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-dossier.api.document', method: 'GET', path: basePath + '/document', document: createDataDossierApiDocument(snapshot) }
  ];
}

