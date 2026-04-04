import { buildCommerceStudioSnapshot, createCommerceStudioApiDocument } from '../service-commerce-studio.mjs';

export function createCommerceStudioApiRoutes(basePath = '/api/commerce-studio') {
  const snapshot = buildCommerceStudioSnapshot();
  return [
    { id: 'commerce-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-studio.api.document', method: 'GET', path: basePath + '/document', document: createCommerceStudioApiDocument(snapshot) }
  ];
}

