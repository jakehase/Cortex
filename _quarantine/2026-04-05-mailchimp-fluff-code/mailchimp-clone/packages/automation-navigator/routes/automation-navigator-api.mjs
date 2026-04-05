import { buildAutomationNavigatorSnapshot, createAutomationNavigatorApiDocument } from '../service-automation-navigator.mjs';

export function createAutomationNavigatorApiRoutes(basePath = '/api/automation-navigator') {
  const snapshot = buildAutomationNavigatorSnapshot();
  return [
    { id: 'automation-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-navigator.api.document', method: 'GET', path: basePath + '/document', document: createAutomationNavigatorApiDocument(snapshot) }
  ];
}

