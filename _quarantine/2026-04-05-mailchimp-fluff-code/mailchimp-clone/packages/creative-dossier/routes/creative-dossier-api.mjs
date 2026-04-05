import { buildCreativeDossierSnapshot, createCreativeDossierApiDocument } from '../service-creative-dossier.mjs';

export function createCreativeDossierApiRoutes(basePath = '/api/creative-dossier') {
  const snapshot = buildCreativeDossierSnapshot();
  return [
    { id: 'creative-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-dossier.api.document', method: 'GET', path: basePath + '/document', document: createCreativeDossierApiDocument(snapshot) }
  ];
}

