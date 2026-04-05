import { buildAnalyticsWatchtowerSnapshot, createAnalyticsWatchtowerApiDocument } from '../service-analytics-watchtower.mjs';

export function createAnalyticsWatchtowerApiRoutes(basePath = '/api/analytics-watchtower') {
  const snapshot = buildAnalyticsWatchtowerSnapshot();
  return [
    { id: 'analytics-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsWatchtowerApiDocument(snapshot) }
  ];
}

