import { buildIntegrationsFoundrySnapshot, createIntegrationsFoundryApiDocument } from '../service-integrations-foundry.mjs';

export function createIntegrationsFoundryApiRoutes(basePath = '/api/integrations-foundry') {
  const snapshot = buildIntegrationsFoundrySnapshot();
  return [
    { id: 'integrations-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-foundry.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsFoundryApiDocument(snapshot) }
  ];
}

