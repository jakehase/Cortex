import { buildActivationConsoleSnapshot, createActivationConsoleApiDocument } from '../service-activation-console.mjs';

export function createActivationConsoleApiRoutes(basePath = '/api/activation-console') {
  const snapshot = buildActivationConsoleSnapshot();
  return [
    { id: 'activation-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-console.api.document', method: 'GET', path: basePath + '/document', document: createActivationConsoleApiDocument(snapshot) }
  ];
}

