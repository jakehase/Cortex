import { buildAnalyticsNavigatorSnapshot, createAnalyticsNavigatorApiDocument } from '../service-analytics-navigator.mjs';

export function createAnalyticsNavigatorApiRoutes(basePath = '/api/analytics-navigator') {
  const snapshot = buildAnalyticsNavigatorSnapshot();
  return [
    { id: 'analytics-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-navigator.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsNavigatorApiDocument(snapshot) }
  ];
}

