import { buildAcquisitionFoundrySnapshot, createAcquisitionFoundryApiDocument } from '../service-acquisition-foundry.mjs';

export function createAcquisitionFoundryApiRoutes(basePath = '/api/acquisition-foundry') {
  const snapshot = buildAcquisitionFoundrySnapshot();
  return [
    { id: 'acquisition-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-foundry.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionFoundryApiDocument(snapshot) }
  ];
}

