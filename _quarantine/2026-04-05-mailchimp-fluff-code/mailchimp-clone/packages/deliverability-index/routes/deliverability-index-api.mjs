import { buildDeliverabilityIndexSnapshot, createDeliverabilityIndexApiDocument } from '../service-deliverability-index.mjs';

export function createDeliverabilityIndexApiRoutes(basePath = '/api/deliverability-index') {
  const snapshot = buildDeliverabilityIndexSnapshot();
  return [
    { id: 'deliverability-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-index.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityIndexApiDocument(snapshot) }
  ];
}

