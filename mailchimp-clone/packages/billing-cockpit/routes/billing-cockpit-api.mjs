import { buildBillingCockpitSnapshot, createBillingCockpitApiDocument } from '../service-billing-cockpit.mjs';

export function createBillingCockpitApiRoutes(basePath = '/api/billing-cockpit') {
  const snapshot = buildBillingCockpitSnapshot();
  return [
    { id: 'billing-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createBillingCockpitApiDocument(snapshot) }
  ];
}

