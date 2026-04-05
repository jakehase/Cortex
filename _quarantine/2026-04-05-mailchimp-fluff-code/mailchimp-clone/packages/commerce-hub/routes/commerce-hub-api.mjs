import { buildCommerceHubSnapshot, createCommerceHubApiDocument } from '../service-commerce-hub.mjs';

export function createCommerceHubApiRoutes(basePath = '/api/commerce-hub') {
  const snapshot = buildCommerceHubSnapshot();
  return [
    { id: 'commerce-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-hub.api.document', method: 'GET', path: basePath + '/document', document: createCommerceHubApiDocument(snapshot) }
  ];
}

