import { buildDataFoundrySnapshot, createDataFoundryApiDocument } from '../service-data-foundry.mjs';

export function createDataFoundryApiRoutes(basePath = '/api/data-foundry') {
  const snapshot = buildDataFoundrySnapshot();
  return [
    { id: 'data-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-foundry.api.document', method: 'GET', path: basePath + '/document', document: createDataFoundryApiDocument(snapshot) }
  ];
}

