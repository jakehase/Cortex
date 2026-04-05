import { buildAnalyticsNotebookSnapshot, createAnalyticsNotebookApiDocument } from '../service-analytics-notebook.mjs';

export function createAnalyticsNotebookApiRoutes(basePath = '/api/analytics-notebook') {
  const snapshot = buildAnalyticsNotebookSnapshot();
  return [
    { id: 'analytics-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-notebook.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsNotebookApiDocument(snapshot) }
  ];
}

