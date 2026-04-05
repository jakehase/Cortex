import { buildActivationIndexSnapshot, createActivationIndexApiDocument } from '../service-activation-index.mjs';

export function createActivationIndexApiRoutes(basePath = '/api/activation-index') {
  const snapshot = buildActivationIndexSnapshot();
  return [
    { id: 'activation-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-index.api.document', method: 'GET', path: basePath + '/document', document: createActivationIndexApiDocument(snapshot) }
  ];
}

