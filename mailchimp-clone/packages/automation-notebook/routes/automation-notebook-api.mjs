import { buildAutomationNotebookSnapshot, createAutomationNotebookApiDocument } from '../service-automation-notebook.mjs';

export function createAutomationNotebookApiRoutes(basePath = '/api/automation-notebook') {
  const snapshot = buildAutomationNotebookSnapshot();
  return [
    { id: 'automation-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-notebook.api.document', method: 'GET', path: basePath + '/document', document: createAutomationNotebookApiDocument(snapshot) }
  ];
}

