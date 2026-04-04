import { buildCommerceAtlasSnapshot, createCommerceAtlasApiDocument } from '../service-commerce-atlas.mjs';

export function createCommerceAtlasApiRoutes(basePath = '/api/commerce-atlas') {
  const snapshot = buildCommerceAtlasSnapshot();
  return [
    { id: 'commerce-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-atlas.api.document', method: 'GET', path: basePath + '/document', document: createCommerceAtlasApiDocument(snapshot) }
  ];
}

