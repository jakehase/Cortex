import { buildAutomationGridSnapshot, createAutomationGridApiDocument } from '../service-automation-grid.mjs';

export function createAutomationGridApiRoutes(basePath = '/api/automation-grid') {
  const snapshot = buildAutomationGridSnapshot();
  return [
    { id: 'automation-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-grid.api.document', method: 'GET', path: basePath + '/document', document: createAutomationGridApiDocument(snapshot) }
  ];
}

