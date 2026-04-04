import { buildAcquisitionIndexSnapshot, createAcquisitionIndexApiDocument } from '../service-acquisition-index.mjs';

export function createAcquisitionIndexApiRoutes(basePath = '/api/acquisition-index') {
  const snapshot = buildAcquisitionIndexSnapshot();
  return [
    { id: 'acquisition-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-index.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionIndexApiDocument(snapshot) }
  ];
}

