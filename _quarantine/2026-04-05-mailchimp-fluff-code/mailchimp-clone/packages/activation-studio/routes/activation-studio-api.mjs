import { buildActivationStudioSnapshot, createActivationStudioApiDocument } from '../service-activation-studio.mjs';

export function createActivationStudioApiRoutes(basePath = '/api/activation-studio') {
  const snapshot = buildActivationStudioSnapshot();
  return [
    { id: 'activation-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-studio.api.document', method: 'GET', path: basePath + '/document', document: createActivationStudioApiDocument(snapshot) }
  ];
}

