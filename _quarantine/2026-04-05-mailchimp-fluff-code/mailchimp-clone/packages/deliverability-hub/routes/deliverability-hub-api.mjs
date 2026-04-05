import { buildDeliverabilityHubSnapshot, createDeliverabilityHubApiDocument } from '../service-deliverability-hub.mjs';

export function createDeliverabilityHubApiRoutes(basePath = '/api/deliverability-hub') {
  const snapshot = buildDeliverabilityHubSnapshot();
  return [
    { id: 'deliverability-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-hub.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityHubApiDocument(snapshot) }
  ];
}

