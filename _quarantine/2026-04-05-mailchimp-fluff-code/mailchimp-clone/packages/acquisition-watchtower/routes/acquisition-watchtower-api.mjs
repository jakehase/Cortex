import { buildAcquisitionWatchtowerSnapshot, createAcquisitionWatchtowerApiDocument } from '../service-acquisition-watchtower.mjs';

export function createAcquisitionWatchtowerApiRoutes(basePath = '/api/acquisition-watchtower') {
  const snapshot = buildAcquisitionWatchtowerSnapshot();
  return [
    { id: 'acquisition-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionWatchtowerApiDocument(snapshot) }
  ];
}

