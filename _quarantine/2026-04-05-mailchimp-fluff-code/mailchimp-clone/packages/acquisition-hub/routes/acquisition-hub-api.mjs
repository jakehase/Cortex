import { buildAcquisitionHubSnapshot, createAcquisitionHubApiDocument } from '../service-acquisition-hub.mjs';

export function createAcquisitionHubApiRoutes(basePath = '/api/acquisition-hub') {
  const snapshot = buildAcquisitionHubSnapshot();
  return [
    { id: 'acquisition-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-hub.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionHubApiDocument(snapshot) }
  ];
}

