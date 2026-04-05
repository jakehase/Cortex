import { buildActivationGridSnapshot, createActivationGridApiDocument } from '../service-activation-grid.mjs';

export function createActivationGridApiRoutes(basePath = '/api/activation-grid') {
  const snapshot = buildActivationGridSnapshot();
  return [
    { id: 'activation-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-grid.api.document', method: 'GET', path: basePath + '/document', document: createActivationGridApiDocument(snapshot) }
  ];
}

