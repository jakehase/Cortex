import { buildDataGridSnapshot, createDataGridApiDocument } from '../service-data-grid.mjs';

export function createDataGridApiRoutes(basePath = '/api/data-grid') {
  const snapshot = buildDataGridSnapshot();
  return [
    { id: 'data-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-grid.api.document', method: 'GET', path: basePath + '/document', document: createDataGridApiDocument(snapshot) }
  ];
}

