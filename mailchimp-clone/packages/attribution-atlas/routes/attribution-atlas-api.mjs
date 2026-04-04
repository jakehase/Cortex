import { buildAttributionAtlasSnapshot, createAttributionAtlasApiDocument } from '../service-attribution-atlas.mjs';

export function createAttributionAtlasApiRoutes(basePath = '/api/attribution-atlas') {
  const snapshot = buildAttributionAtlasSnapshot();
  return [
    { id: 'attribution-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-atlas.api.document', method: 'GET', path: basePath + '/document', document: createAttributionAtlasApiDocument(snapshot) }
  ];
}

