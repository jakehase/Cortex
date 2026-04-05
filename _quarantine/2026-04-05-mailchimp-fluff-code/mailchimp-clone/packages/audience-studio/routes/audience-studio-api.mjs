import { buildAudienceStudioSnapshot, createAudienceStudioApiDocument } from '../service-audience-studio.mjs';

export function createAudienceStudioApiRoutes(basePath = '/api/audience-studio') {
  const snapshot = buildAudienceStudioSnapshot();
  return [
    { id: 'audience-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-studio.api.document', method: 'GET', path: basePath + '/document', document: createAudienceStudioApiDocument(snapshot) }
  ];
}

