import { buildAutomationIndexSnapshot, createAutomationIndexApiDocument } from '../service-automation-index.mjs';

export function createAutomationIndexApiRoutes(basePath = '/api/automation-index') {
  const snapshot = buildAutomationIndexSnapshot();
  return [
    { id: 'automation-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-index.api.document', method: 'GET', path: basePath + '/document', document: createAutomationIndexApiDocument(snapshot) }
  ];
}

