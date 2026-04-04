import { buildDataStudioSnapshot, createDataStudioApiDocument } from '../service-data-studio.mjs';

export function createDataStudioApiRoutes(basePath = '/api/data-studio') {
  const snapshot = buildDataStudioSnapshot();
  return [
    { id: 'data-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-studio.api.document', method: 'GET', path: basePath + '/document', document: createDataStudioApiDocument(snapshot) }
  ];
}

