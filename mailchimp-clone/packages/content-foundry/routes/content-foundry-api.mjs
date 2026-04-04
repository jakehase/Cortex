import { buildContentFoundrySnapshot, createContentFoundryApiDocument } from '../service-content-foundry.mjs';

export function createContentFoundryApiRoutes(basePath = '/api/content-foundry') {
  const snapshot = buildContentFoundrySnapshot();
  return [
    { id: 'content-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-foundry.api.document', method: 'GET', path: basePath + '/document', document: createContentFoundryApiDocument(snapshot) }
  ];
}

