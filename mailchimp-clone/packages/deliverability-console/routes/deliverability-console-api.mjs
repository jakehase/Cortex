import { buildDeliverabilityConsoleSnapshot, createDeliverabilityConsoleApiDocument } from '../service-deliverability-console.mjs';

export function createDeliverabilityConsoleApiRoutes(basePath = '/api/deliverability-console') {
  const snapshot = buildDeliverabilityConsoleSnapshot();
  return [
    { id: 'deliverability-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-console.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityConsoleApiDocument(snapshot) }
  ];
}

