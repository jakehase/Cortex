import { buildCustomerCockpitSnapshot, createCustomerCockpitApiDocument } from '../service-customer-cockpit.mjs';

export function createCustomerCockpitApiRoutes(basePath = '/api/customer-cockpit') {
  const snapshot = buildCustomerCockpitSnapshot();
  return [
    { id: 'customer-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createCustomerCockpitApiDocument(snapshot) }
  ];
}

