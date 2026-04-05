import { buildInsightsSentinelSnapshot, createInsightsSentinelApiDocument } from '../service-insights-sentinel.mjs';

export function createInsightsSentinelApiRoutes(basePath = '/api/insights-sentinel') {
  const snapshot = buildInsightsSentinelSnapshot();
  return [
    { id: 'insights-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createInsightsSentinelApiDocument(snapshot) }
  ];
}

