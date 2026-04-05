import { buildAcquisitionNavigatorSnapshot, createAcquisitionNavigatorApiDocument } from '../service-acquisition-navigator.mjs';

export function createAcquisitionNavigatorApiRoutes(basePath = '/api/acquisition-navigator') {
  const snapshot = buildAcquisitionNavigatorSnapshot();
  return [
    { id: 'acquisition-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-navigator.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionNavigatorApiDocument(snapshot) }
  ];
}

