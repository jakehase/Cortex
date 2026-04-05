import { buildAdvocacyLedgerSnapshot, createAdvocacyLedgerApiDocument } from '../service-advocacy-ledger.mjs';

export function createAdvocacyLedgerApiRoutes(basePath = '/api/advocacy-ledger') {
  const snapshot = buildAdvocacyLedgerSnapshot();
  return [
    { id: 'advocacy-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-ledger.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyLedgerApiDocument(snapshot) }
  ];
}

