import { buildInsightsNotebookSnapshot, createInsightsNotebookApiDocument } from '../service-insights-notebook.mjs';

export function createInsightsNotebookApiRoutes(basePath = '/api/insights-notebook') {
  const snapshot = buildInsightsNotebookSnapshot();
  return [
    { id: 'insights-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-notebook.api.document', method: 'GET', path: basePath + '/document', document: createInsightsNotebookApiDocument(snapshot) }
  ];
}

