import { buildContentStudioSnapshot, createContentStudioApiDocument } from '../service-content-studio.mjs';

export function createContentStudioApiRoutes(basePath = '/api/content-studio') {
  const snapshot = buildContentStudioSnapshot();
  return [
    { id: 'content-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-studio.api.document', method: 'GET', path: basePath + '/document', document: createContentStudioApiDocument(snapshot) }
  ];
}

