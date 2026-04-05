import { buildDeliverabilityFoundrySnapshot, createDeliverabilityFoundryApiDocument } from '../service-deliverability-foundry.mjs';

export function createDeliverabilityFoundryApiRoutes(basePath = '/api/deliverability-foundry') {
  const snapshot = buildDeliverabilityFoundrySnapshot();
  return [
    { id: 'deliverability-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-foundry.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityFoundryApiDocument(snapshot) }
  ];
}

