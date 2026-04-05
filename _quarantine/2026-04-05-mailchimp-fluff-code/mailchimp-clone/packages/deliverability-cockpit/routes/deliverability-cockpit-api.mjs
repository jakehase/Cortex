import { buildDeliverabilityCockpitSnapshot, createDeliverabilityCockpitApiDocument } from '../service-deliverability-cockpit.mjs';

export function createDeliverabilityCockpitApiRoutes(basePath = '/api/deliverability-cockpit') {
  const snapshot = buildDeliverabilityCockpitSnapshot();
  return [
    { id: 'deliverability-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityCockpitApiDocument(snapshot) }
  ];
}

