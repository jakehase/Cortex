import { buildCustomerAtlasSnapshot, createCustomerAtlasApiDocument } from '../service-customer-atlas.mjs';

export function createCustomerAtlasApiRoutes(basePath = '/api/customer-atlas') {
  const snapshot = buildCustomerAtlasSnapshot();
  return [
    { id: 'customer-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-atlas.api.document', method: 'GET', path: basePath + '/document', document: createCustomerAtlasApiDocument(snapshot) }
  ];
}

