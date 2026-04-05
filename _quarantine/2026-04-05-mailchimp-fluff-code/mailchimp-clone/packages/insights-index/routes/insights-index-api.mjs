import { buildInsightsIndexSnapshot, createInsightsIndexApiDocument } from '../service-insights-index.mjs';

export function createInsightsIndexApiRoutes(basePath = '/api/insights-index') {
  const snapshot = buildInsightsIndexSnapshot();
  return [
    { id: 'insights-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-index.api.document', method: 'GET', path: basePath + '/document', document: createInsightsIndexApiDocument(snapshot) }
  ];
}

