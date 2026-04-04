import { buildAttributionSentinelSnapshot, createAttributionSentinelApiDocument } from '../service-attribution-sentinel.mjs';

export function createAttributionSentinelApiRoutes(basePath = '/api/attribution-sentinel') {
  const snapshot = buildAttributionSentinelSnapshot();
  return [
    { id: 'attribution-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createAttributionSentinelApiDocument(snapshot) }
  ];
}

