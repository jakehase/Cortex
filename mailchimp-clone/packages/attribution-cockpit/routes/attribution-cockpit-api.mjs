import { buildAttributionCockpitSnapshot, createAttributionCockpitApiDocument } from '../service-attribution-cockpit.mjs';

export function createAttributionCockpitApiRoutes(basePath = '/api/attribution-cockpit') {
  const snapshot = buildAttributionCockpitSnapshot();
  return [
    { id: 'attribution-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createAttributionCockpitApiDocument(snapshot) }
  ];
}

