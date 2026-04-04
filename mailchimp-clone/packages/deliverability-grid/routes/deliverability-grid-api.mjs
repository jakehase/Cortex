import { buildDeliverabilityGridSnapshot, createDeliverabilityGridApiDocument } from '../service-deliverability-grid.mjs';

export function createDeliverabilityGridApiRoutes(basePath = '/api/deliverability-grid') {
  const snapshot = buildDeliverabilityGridSnapshot();
  return [
    { id: 'deliverability-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-grid.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityGridApiDocument(snapshot) }
  ];
}

