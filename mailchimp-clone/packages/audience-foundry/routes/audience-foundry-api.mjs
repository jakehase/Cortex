import { buildAudienceFoundrySnapshot, createAudienceFoundryApiDocument } from '../service-audience-foundry.mjs';

export function createAudienceFoundryApiRoutes(basePath = '/api/audience-foundry') {
  const snapshot = buildAudienceFoundrySnapshot();
  return [
    { id: 'audience-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-foundry.api.document', method: 'GET', path: basePath + '/document', document: createAudienceFoundryApiDocument(snapshot) }
  ];
}

