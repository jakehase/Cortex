import { buildCommerceWatchtowerSnapshot, createCommerceWatchtowerApiDocument } from '../service-commerce-watchtower.mjs';

export function createCommerceWatchtowerApiRoutes(basePath = '/api/commerce-watchtower') {
  const snapshot = buildCommerceWatchtowerSnapshot();
  return [
    { id: 'commerce-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createCommerceWatchtowerApiDocument(snapshot) }
  ];
}

