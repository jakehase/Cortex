import { buildAnalyticsStudioSnapshot, createAnalyticsStudioApiDocument } from '../service-analytics-studio.mjs';

export function createAnalyticsStudioApiRoutes(basePath = '/api/analytics-studio') {
  const snapshot = buildAnalyticsStudioSnapshot();
  return [
    { id: 'analytics-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-studio.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsStudioApiDocument(snapshot) }
  ];
}

