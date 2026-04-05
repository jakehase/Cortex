import { buildAcquisitionWorkbenchSnapshot, createAcquisitionWorkbenchApiDocument } from '../service-acquisition-workbench.mjs';

export function createAcquisitionWorkbenchApiRoutes(basePath = '/api/acquisition-workbench') {
  const snapshot = buildAcquisitionWorkbenchSnapshot();
  return [
    { id: 'acquisition-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-workbench.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionWorkbenchApiDocument(snapshot) }
  ];
}

