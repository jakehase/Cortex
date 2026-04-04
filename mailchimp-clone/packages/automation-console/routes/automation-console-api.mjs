import { buildAutomationConsoleSnapshot, createAutomationConsoleApiDocument } from '../service-automation-console.mjs';

export function createAutomationConsoleApiRoutes(basePath = '/api/automation-console') {
  const snapshot = buildAutomationConsoleSnapshot();
  return [
    { id: 'automation-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-console.api.document', method: 'GET', path: basePath + '/document', document: createAutomationConsoleApiDocument(snapshot) }
  ];
}

