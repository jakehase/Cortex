import { buildAdvocacyStudioSnapshot, createAdvocacyStudioApiDocument } from '../service-advocacy-studio.mjs';

export function createAdvocacyStudioApiRoutes(basePath = '/api/advocacy-studio') {
  const snapshot = buildAdvocacyStudioSnapshot();
  return [
    { id: 'advocacy-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-studio.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyStudioApiDocument(snapshot) }
  ];
}

