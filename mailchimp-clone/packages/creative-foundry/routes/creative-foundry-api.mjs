import { buildCreativeFoundrySnapshot, createCreativeFoundryApiDocument } from '../service-creative-foundry.mjs';

export function createCreativeFoundryApiRoutes(basePath = '/api/creative-foundry') {
  const snapshot = buildCreativeFoundrySnapshot();
  return [
    { id: 'creative-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-foundry.api.document', method: 'GET', path: basePath + '/document', document: createCreativeFoundryApiDocument(snapshot) }
  ];
}

