import { buildCommerceConsoleSnapshot, createCommerceConsoleApiDocument } from '../service-commerce-console.mjs';

export function createCommerceConsoleApiRoutes(basePath = '/api/commerce-console') {
  const snapshot = buildCommerceConsoleSnapshot();
  return [
    { id: 'commerce-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-console.api.document', method: 'GET', path: basePath + '/document', document: createCommerceConsoleApiDocument(snapshot) }
  ];
}

