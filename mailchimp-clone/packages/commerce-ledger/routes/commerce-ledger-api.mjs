import { buildCommerceLedgerSnapshot, createCommerceLedgerApiDocument } from '../service-commerce-ledger.mjs';

export function createCommerceLedgerApiRoutes(basePath = '/api/commerce-ledger') {
  const snapshot = buildCommerceLedgerSnapshot();
  return [
    { id: 'commerce-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-ledger.api.document', method: 'GET', path: basePath + '/document', document: createCommerceLedgerApiDocument(snapshot) }
  ];
}

