import { buildCommerceNavigatorSnapshot, createCommerceNavigatorApiDocument } from '../service-commerce-navigator.mjs';

export function createCommerceNavigatorApiRoutes(basePath = '/api/commerce-navigator') {
  const snapshot = buildCommerceNavigatorSnapshot();
  return [
    { id: 'commerce-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-navigator.api.document', method: 'GET', path: basePath + '/document', document: createCommerceNavigatorApiDocument(snapshot) }
  ];
}

