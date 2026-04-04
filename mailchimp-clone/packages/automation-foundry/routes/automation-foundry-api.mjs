import { buildAutomationFoundrySnapshot, createAutomationFoundryApiDocument } from '../service-automation-foundry.mjs';

export function createAutomationFoundryApiRoutes(basePath = '/api/automation-foundry') {
  const snapshot = buildAutomationFoundrySnapshot();
  return [
    { id: 'automation-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-foundry.api.document', method: 'GET', path: basePath + '/document', document: createAutomationFoundryApiDocument(snapshot) }
  ];
}

