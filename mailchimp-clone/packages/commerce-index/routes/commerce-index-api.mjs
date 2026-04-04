import { buildCommerceIndexSnapshot, createCommerceIndexApiDocument } from '../service-commerce-index.mjs';

export function createCommerceIndexApiRoutes(basePath = '/api/commerce-index') {
  const snapshot = buildCommerceIndexSnapshot();
  return [
    { id: 'commerce-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-index.api.document', method: 'GET', path: basePath + '/document', document: createCommerceIndexApiDocument(snapshot) }
  ];
}

