import { buildActivationFoundrySnapshot, createActivationFoundryApiDocument } from '../service-activation-foundry.mjs';

export function createActivationFoundryApiRoutes(basePath = '/api/activation-foundry') {
  const snapshot = buildActivationFoundrySnapshot();
  return [
    { id: 'activation-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-foundry.api.document', method: 'GET', path: basePath + '/document', document: createActivationFoundryApiDocument(snapshot) }
  ];
}

