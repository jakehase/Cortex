import { buildBillingExchangeSnapshot, createBillingExchangeApiDocument } from '../service-billing-exchange.mjs';

export function createBillingExchangeApiRoutes(basePath = '/api/billing-exchange') {
  const snapshot = buildBillingExchangeSnapshot();
  return [
    { id: 'billing-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-exchange.api.document', method: 'GET', path: basePath + '/document', document: createBillingExchangeApiDocument(snapshot) }
  ];
}

