import { buildLifecycleSentinelSnapshot, createLifecycleSentinelApiDocument } from '../service-lifecycle-sentinel.mjs';

export function createLifecycleSentinelApiRoutes(basePath = '/api/lifecycle-sentinel') {
  const snapshot = buildLifecycleSentinelSnapshot();
  return [
    { id: 'lifecycle-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleSentinelApiDocument(snapshot) }
  ];
}

