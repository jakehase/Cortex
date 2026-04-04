import { buildAcquisitionGridSnapshot, createAcquisitionGridApiDocument } from '../service-acquisition-grid.mjs';

export function createAcquisitionGridApiRoutes(basePath = '/api/acquisition-grid') {
  const snapshot = buildAcquisitionGridSnapshot();
  return [
    { id: 'acquisition-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-grid.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionGridApiDocument(snapshot) }
  ];
}

