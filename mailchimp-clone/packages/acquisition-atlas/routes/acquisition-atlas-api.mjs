import { buildAcquisitionAtlasSnapshot, createAcquisitionAtlasApiDocument } from '../service-acquisition-atlas.mjs';

export function createAcquisitionAtlasApiRoutes(basePath = '/api/acquisition-atlas') {
  const snapshot = buildAcquisitionAtlasSnapshot();
  return [
    { id: 'acquisition-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-atlas.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionAtlasApiDocument(snapshot) }
  ];
}

