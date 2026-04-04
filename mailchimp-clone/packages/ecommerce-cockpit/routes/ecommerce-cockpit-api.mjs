import { buildEcommerceCockpitSnapshot, createEcommerceCockpitApiDocument } from '../service-ecommerce-cockpit.mjs';

export function createEcommerceCockpitApiRoutes(basePath = '/api/ecommerce-cockpit') {
  const snapshot = buildEcommerceCockpitSnapshot();
  return [
    { id: 'ecommerce-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceCockpitApiDocument(snapshot) }
  ];
}

