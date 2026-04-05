import { buildActivationHubSnapshot, createActivationHubApiDocument } from '../service-activation-hub.mjs';

export function createActivationHubApiRoutes(basePath = '/api/activation-hub') {
  const snapshot = buildActivationHubSnapshot();
  return [
    { id: 'activation-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-hub.api.document', method: 'GET', path: basePath + '/document', document: createActivationHubApiDocument(snapshot) }
  ];
}

