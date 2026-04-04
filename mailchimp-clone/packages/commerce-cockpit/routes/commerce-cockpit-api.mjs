import { buildCommerceCockpitSnapshot, createCommerceCockpitApiDocument } from '../service-commerce-cockpit.mjs';

export function createCommerceCockpitApiRoutes(basePath = '/api/commerce-cockpit') {
  const snapshot = buildCommerceCockpitSnapshot();
  return [
    { id: 'commerce-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createCommerceCockpitApiDocument(snapshot) }
  ];
}

