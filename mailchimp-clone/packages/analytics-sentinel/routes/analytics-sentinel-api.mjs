import { buildAnalyticsSentinelSnapshot, createAnalyticsSentinelApiDocument } from '../service-analytics-sentinel.mjs';

export function createAnalyticsSentinelApiRoutes(basePath = '/api/analytics-sentinel') {
  const snapshot = buildAnalyticsSentinelSnapshot();
  return [
    { id: 'analytics-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsSentinelApiDocument(snapshot) }
  ];
}

