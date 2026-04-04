import { buildCommerceFoundrySnapshot, createCommerceFoundryApiDocument } from '../service-commerce-foundry.mjs';

export function createCommerceFoundryApiRoutes(basePath = '/api/commerce-foundry') {
  const snapshot = buildCommerceFoundrySnapshot();
  return [
    { id: 'commerce-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-foundry.api.document', method: 'GET', path: basePath + '/document', document: createCommerceFoundryApiDocument(snapshot) }
  ];
}

