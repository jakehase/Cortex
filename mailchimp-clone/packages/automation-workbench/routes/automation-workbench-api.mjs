import { buildAutomationWorkbenchSnapshot, createAutomationWorkbenchApiDocument } from '../service-automation-workbench.mjs';

export function createAutomationWorkbenchApiRoutes(basePath = '/api/automation-workbench') {
  const snapshot = buildAutomationWorkbenchSnapshot();
  return [
    { id: 'automation-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-workbench.api.document', method: 'GET', path: basePath + '/document', document: createAutomationWorkbenchApiDocument(snapshot) }
  ];
}

