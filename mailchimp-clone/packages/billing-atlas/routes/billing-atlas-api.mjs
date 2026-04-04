import { buildBillingAtlasSnapshot, createBillingAtlasApiDocument } from '../service-billing-atlas.mjs';

export function createBillingAtlasApiRoutes(basePath = '/api/billing-atlas') {
  const snapshot = buildBillingAtlasSnapshot();
  return [
    { id: 'billing-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-atlas.api.document', method: 'GET', path: basePath + '/document', document: createBillingAtlasApiDocument(snapshot) }
  ];
}

