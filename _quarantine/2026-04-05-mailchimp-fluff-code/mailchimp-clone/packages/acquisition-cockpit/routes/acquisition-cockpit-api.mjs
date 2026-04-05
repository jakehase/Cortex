import { buildAcquisitionCockpitSnapshot, createAcquisitionCockpitApiDocument } from '../service-acquisition-cockpit.mjs';

export function createAcquisitionCockpitApiRoutes(basePath = '/api/acquisition-cockpit') {
  const snapshot = buildAcquisitionCockpitSnapshot();
  return [
    { id: 'acquisition-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionCockpitApiDocument(snapshot) }
  ];
}

