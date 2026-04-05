import { buildAutomationHubSnapshot, createAutomationHubApiDocument } from '../service-automation-hub.mjs';

export function createAutomationHubApiRoutes(basePath = '/api/automation-hub') {
  const snapshot = buildAutomationHubSnapshot();
  return [
    { id: 'automation-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-hub.api.document', method: 'GET', path: basePath + '/document', document: createAutomationHubApiDocument(snapshot) }
  ];
}

