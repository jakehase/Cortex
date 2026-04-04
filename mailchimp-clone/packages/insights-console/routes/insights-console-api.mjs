import { buildInsightsConsoleSnapshot, createInsightsConsoleApiDocument } from '../service-insights-console.mjs';

export function createInsightsConsoleApiRoutes(basePath = '/api/insights-console') {
  const snapshot = buildInsightsConsoleSnapshot();
  return [
    { id: 'insights-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-console.api.document', method: 'GET', path: basePath + '/document', document: createInsightsConsoleApiDocument(snapshot) }
  ];
}

