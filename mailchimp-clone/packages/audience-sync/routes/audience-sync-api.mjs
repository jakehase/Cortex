import { buildAudienceSyncSnapshot, createAudienceSyncApiDocument } from '../service-audience-sync.mjs';

export function createAudienceSyncApiRoutes(basePath = '/api/audience-sync') {
  const snapshot = buildAudienceSyncSnapshot();
  return [
    { id: 'audience-sync.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-sync.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-sync.api.document', method: 'GET', path: basePath + '/document', document: createAudienceSyncApiDocument(snapshot) }
  ];
}
