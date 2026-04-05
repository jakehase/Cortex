import { buildCreativeStudioSnapshot, createCreativeStudioApiDocument } from '../service-creative-studio.mjs';

export function createCreativeStudioApiRoutes(basePath = '/api/creative-studio') {
  const snapshot = buildCreativeStudioSnapshot();
  return [
    { id: 'creative-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-studio.api.document', method: 'GET', path: basePath + '/document', document: createCreativeStudioApiDocument(snapshot) }
  ];
}

