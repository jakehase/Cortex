import { buildCommerceSentinelSnapshot, createCommerceSentinelApiDocument } from '../service-commerce-sentinel.mjs';

export function createCommerceSentinelApiRoutes(basePath = '/api/commerce-sentinel') {
  const snapshot = buildCommerceSentinelSnapshot();
  return [
    { id: 'commerce-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createCommerceSentinelApiDocument(snapshot) }
  ];
}

