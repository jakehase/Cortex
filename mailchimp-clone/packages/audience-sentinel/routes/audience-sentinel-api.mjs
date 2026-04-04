import { buildAudienceSentinelSnapshot, createAudienceSentinelApiDocument } from '../service-audience-sentinel.mjs';

export function createAudienceSentinelApiRoutes(basePath = '/api/audience-sentinel') {
  const snapshot = buildAudienceSentinelSnapshot();
  return [
    { id: 'audience-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createAudienceSentinelApiDocument(snapshot) }
  ];
}

