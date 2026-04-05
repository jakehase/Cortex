import { buildBillingLedgerSnapshot, createBillingLedgerApiDocument } from '../service-billing-ledger.mjs';

export function createBillingLedgerApiRoutes(basePath = '/api/billing-ledger') {
  const snapshot = buildBillingLedgerSnapshot();
  return [
    { id: 'billing-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-ledger.api.document', method: 'GET', path: basePath + '/document', document: createBillingLedgerApiDocument(snapshot) }
  ];
}

