import { buildDataCockpitSnapshot, createDataCockpitApiDocument } from '../service-data-cockpit.mjs';

export function createDataCockpitApiRoutes(basePath = '/api/data-cockpit') {
  const snapshot = buildDataCockpitSnapshot();
  return [
    { id: 'data-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createDataCockpitApiDocument(snapshot) }
  ];
}

