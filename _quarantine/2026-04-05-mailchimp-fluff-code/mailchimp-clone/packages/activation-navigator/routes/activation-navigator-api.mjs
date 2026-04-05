import { buildActivationNavigatorSnapshot, createActivationNavigatorApiDocument } from '../service-activation-navigator.mjs';

export function createActivationNavigatorApiRoutes(basePath = '/api/activation-navigator') {
  const snapshot = buildActivationNavigatorSnapshot();
  return [
    { id: 'activation-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-navigator.api.document', method: 'GET', path: basePath + '/document', document: createActivationNavigatorApiDocument(snapshot) }
  ];
}

