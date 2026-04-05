import { buildAttributionFoundrySnapshot, createAttributionFoundryApiDocument } from '../service-attribution-foundry.mjs';

export function createAttributionFoundryApiRoutes(basePath = '/api/attribution-foundry') {
  const snapshot = buildAttributionFoundrySnapshot();
  return [
    { id: 'attribution-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-foundry.api.document', method: 'GET', path: basePath + '/document', document: createAttributionFoundryApiDocument(snapshot) }
  ];
}

