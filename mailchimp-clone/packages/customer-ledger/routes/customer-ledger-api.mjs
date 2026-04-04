import { buildCustomerLedgerSnapshot, createCustomerLedgerApiDocument } from '../service-customer-ledger.mjs';

export function createCustomerLedgerApiRoutes(basePath = '/api/customer-ledger') {
  const snapshot = buildCustomerLedgerSnapshot();
  return [
    { id: 'customer-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-ledger.api.document', method: 'GET', path: basePath + '/document', document: createCustomerLedgerApiDocument(snapshot) }
  ];
}

