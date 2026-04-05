import { buildDeliverabilityNavigatorSnapshot, createDeliverabilityNavigatorApiDocument } from '../service-deliverability-navigator.mjs';

export function createDeliverabilityNavigatorApiRoutes(basePath = '/api/deliverability-navigator') {
  const snapshot = buildDeliverabilityNavigatorSnapshot();
  return [
    { id: 'deliverability-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-navigator.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityNavigatorApiDocument(snapshot) }
  ];
}

