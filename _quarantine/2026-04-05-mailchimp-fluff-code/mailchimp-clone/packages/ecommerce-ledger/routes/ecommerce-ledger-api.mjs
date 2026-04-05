import { buildEcommerceLedgerSnapshot, createEcommerceLedgerApiDocument } from '../service-ecommerce-ledger.mjs';

export function createEcommerceLedgerApiRoutes(basePath = '/api/ecommerce-ledger') {
  const snapshot = buildEcommerceLedgerSnapshot();
  return [
    { id: 'ecommerce-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-ledger.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceLedgerApiDocument(snapshot) }
  ];
}

