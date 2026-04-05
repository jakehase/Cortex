import { buildAttributionNotebookSnapshot, createAttributionNotebookApiDocument } from '../service-attribution-notebook.mjs';

export function createAttributionNotebookApiRoutes(basePath = '/api/attribution-notebook') {
  const snapshot = buildAttributionNotebookSnapshot();
  return [
    { id: 'attribution-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-notebook.api.document', method: 'GET', path: basePath + '/document', document: createAttributionNotebookApiDocument(snapshot) }
  ];
}

