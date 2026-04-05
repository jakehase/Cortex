import { buildAcquisitionStudioSnapshot, createAcquisitionStudioApiDocument } from '../service-acquisition-studio.mjs';

export function createAcquisitionStudioApiRoutes(basePath = '/api/acquisition-studio') {
  const snapshot = buildAcquisitionStudioSnapshot();
  return [
    { id: 'acquisition-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-studio.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionStudioApiDocument(snapshot) }
  ];
}

