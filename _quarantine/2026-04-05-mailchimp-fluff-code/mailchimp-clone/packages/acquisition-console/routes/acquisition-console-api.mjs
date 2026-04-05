import { buildAcquisitionConsoleSnapshot, createAcquisitionConsoleApiDocument } from '../service-acquisition-console.mjs';

export function createAcquisitionConsoleApiRoutes(basePath = '/api/acquisition-console') {
  const snapshot = buildAcquisitionConsoleSnapshot();
  return [
    { id: 'acquisition-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-console.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionConsoleApiDocument(snapshot) }
  ];
}

