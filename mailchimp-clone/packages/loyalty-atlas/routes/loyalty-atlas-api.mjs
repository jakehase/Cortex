import { buildLoyaltyAtlasSnapshot, createLoyaltyAtlasApiDocument } from '../service-loyalty-atlas.mjs';

export function createLoyaltyAtlasApiRoutes(basePath = '/api/loyalty-atlas') {
  const snapshot = buildLoyaltyAtlasSnapshot();
  return [
    { id: 'loyalty-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-atlas.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyAtlasApiDocument(snapshot) }
  ];
}

