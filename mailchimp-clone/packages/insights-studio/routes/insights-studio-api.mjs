import { buildInsightsStudioSnapshot, createInsightsStudioApiDocument } from '../service-insights-studio.mjs';

export function createInsightsStudioApiRoutes(basePath = '/api/insights-studio') {
  const snapshot = buildInsightsStudioSnapshot();
  return [
    { id: 'insights-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-studio.api.document', method: 'GET', path: basePath + '/document', document: createInsightsStudioApiDocument(snapshot) }
  ];
}

