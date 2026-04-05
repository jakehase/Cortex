import { buildEcommerceSentinelSnapshot, createEcommerceSentinelApiDocument } from '../service-ecommerce-sentinel.mjs';

export function createEcommerceSentinelApiRoutes(basePath = '/api/ecommerce-sentinel') {
  const snapshot = buildEcommerceSentinelSnapshot();
  return [
    { id: 'ecommerce-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceSentinelApiDocument(snapshot) }
  ];
}

