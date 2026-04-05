import { buildInsightsHubSnapshot, createInsightsHubApiDocument } from '../service-insights-hub.mjs';

export function createInsightsHubApiRoutes(basePath = '/api/insights-hub') {
  const snapshot = buildInsightsHubSnapshot();
  return [
    { id: 'insights-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-hub.api.document', method: 'GET', path: basePath + '/document', document: createInsightsHubApiDocument(snapshot) }
  ];
}

