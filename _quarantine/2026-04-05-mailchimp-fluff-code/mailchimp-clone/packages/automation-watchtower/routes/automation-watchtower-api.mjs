import { buildAutomationWatchtowerSnapshot, createAutomationWatchtowerApiDocument } from '../service-automation-watchtower.mjs';

export function createAutomationWatchtowerApiRoutes(basePath = '/api/automation-watchtower') {
  const snapshot = buildAutomationWatchtowerSnapshot();
  return [
    { id: 'automation-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createAutomationWatchtowerApiDocument(snapshot) }
  ];
}

