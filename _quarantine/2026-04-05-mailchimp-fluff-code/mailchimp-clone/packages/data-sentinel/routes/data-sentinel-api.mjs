import { buildDataSentinelSnapshot, createDataSentinelApiDocument } from '../service-data-sentinel.mjs';

export function createDataSentinelApiRoutes(basePath = '/api/data-sentinel') {
  const snapshot = buildDataSentinelSnapshot();
  return [
    { id: 'data-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createDataSentinelApiDocument(snapshot) }
  ];
}

