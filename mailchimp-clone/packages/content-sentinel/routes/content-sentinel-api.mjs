import { buildContentSentinelSnapshot, createContentSentinelApiDocument } from '../service-content-sentinel.mjs';

export function createContentSentinelApiRoutes(basePath = '/api/content-sentinel') {
  const snapshot = buildContentSentinelSnapshot();
  return [
    { id: 'content-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createContentSentinelApiDocument(snapshot) }
  ];
}

