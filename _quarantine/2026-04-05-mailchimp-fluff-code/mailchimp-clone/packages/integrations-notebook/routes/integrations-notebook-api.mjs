import { buildIntegrationsNotebookSnapshot, createIntegrationsNotebookApiDocument } from '../service-integrations-notebook.mjs';

export function createIntegrationsNotebookApiRoutes(basePath = '/api/integrations-notebook') {
  const snapshot = buildIntegrationsNotebookSnapshot();
  return [
    { id: 'integrations-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-notebook.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsNotebookApiDocument(snapshot) }
  ];
}

