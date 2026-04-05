import { buildAdvocacySentinelSnapshot, createAdvocacySentinelApiDocument } from '../service-advocacy-sentinel.mjs';

export function createAdvocacySentinelApiRoutes(basePath = '/api/advocacy-sentinel') {
  const snapshot = buildAdvocacySentinelSnapshot();
  return [
    { id: 'advocacy-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacySentinelApiDocument(snapshot) }
  ];
}

