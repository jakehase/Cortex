import { buildAdvocacyFoundrySnapshot, createAdvocacyFoundryApiDocument } from '../service-advocacy-foundry.mjs';

export function createAdvocacyFoundryApiRoutes(basePath = '/api/advocacy-foundry') {
  const snapshot = buildAdvocacyFoundrySnapshot();
  return [
    { id: 'advocacy-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-foundry.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyFoundryApiDocument(snapshot) }
  ];
}

