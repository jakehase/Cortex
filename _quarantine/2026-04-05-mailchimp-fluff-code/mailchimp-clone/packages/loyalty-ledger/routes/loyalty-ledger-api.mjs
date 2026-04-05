import { buildLoyaltyLedgerSnapshot, createLoyaltyLedgerApiDocument } from '../service-loyalty-ledger.mjs';

export function createLoyaltyLedgerApiRoutes(basePath = '/api/loyalty-ledger') {
  const snapshot = buildLoyaltyLedgerSnapshot();
  return [
    { id: 'loyalty-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-ledger.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyLedgerApiDocument(snapshot) }
  ];
}

