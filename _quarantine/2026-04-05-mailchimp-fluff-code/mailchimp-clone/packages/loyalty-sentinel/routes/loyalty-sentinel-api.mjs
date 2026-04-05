import { buildLoyaltySentinelSnapshot, createLoyaltySentinelApiDocument } from '../service-loyalty-sentinel.mjs';

export function createLoyaltySentinelApiRoutes(basePath = '/api/loyalty-sentinel') {
  const snapshot = buildLoyaltySentinelSnapshot();
  return [
    { id: 'loyalty-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltySentinelApiDocument(snapshot) }
  ];
}

