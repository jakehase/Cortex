import { buildPartnerAtlasSnapshot, createPartnerAtlasApiDocument } from '../service-partner-atlas.mjs';

export function createPartnerAtlasApiRoutes(basePath = '/api/partner-atlas') {
  const snapshot = buildPartnerAtlasSnapshot();
  return [
    { id: 'partner-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'partner-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'partner-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'partner-atlas.api.document', method: 'GET', path: basePath + '/document', document: createPartnerAtlasApiDocument(snapshot) }
  ];
}

