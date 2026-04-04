import { buildDeliverabilityExchangeSnapshot, createDeliverabilityExchangeApiDocument } from '../service-deliverability-exchange.mjs';

export function createDeliverabilityExchangeApiRoutes(basePath = '/api/deliverability-exchange') {
  const snapshot = buildDeliverabilityExchangeSnapshot();
  return [
    { id: 'deliverability-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-exchange.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityExchangeApiDocument(snapshot) }
  ];
}

