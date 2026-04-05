import { buildAudienceConsoleSnapshot, createAudienceConsoleApiDocument } from '../service-audience-console.mjs';

export function createAudienceConsoleApiRoutes(basePath = '/api/audience-console') {
  const snapshot = buildAudienceConsoleSnapshot();
  return [
    { id: 'audience-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-console.api.document', method: 'GET', path: basePath + '/document', document: createAudienceConsoleApiDocument(snapshot) }
  ];
}

