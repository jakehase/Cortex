import { buildCreativeSentinelSnapshot, createCreativeSentinelApiDocument } from '../service-creative-sentinel.mjs';

export function createCreativeSentinelApiRoutes(basePath = '/api/creative-sentinel') {
  const snapshot = buildCreativeSentinelSnapshot();
  return [
    { id: 'creative-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createCreativeSentinelApiDocument(snapshot) }
  ];
}

