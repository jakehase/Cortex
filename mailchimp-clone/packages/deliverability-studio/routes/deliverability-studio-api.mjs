import { buildDeliverabilityStudioSnapshot, createDeliverabilityStudioApiDocument } from '../service-deliverability-studio.mjs';

export function createDeliverabilityStudioApiRoutes(basePath = '/api/deliverability-studio') {
  const snapshot = buildDeliverabilityStudioSnapshot();
  return [
    { id: 'deliverability-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-studio.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityStudioApiDocument(snapshot) }
  ];
}

