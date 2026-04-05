import { buildContentLedgerSnapshot, createContentLedgerApiDocument } from '../service-content-ledger.mjs';

export function createContentLedgerApiRoutes(basePath = '/api/content-ledger') {
  const snapshot = buildContentLedgerSnapshot();
  return [
    { id: 'content-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-ledger.api.document', method: 'GET', path: basePath + '/document', document: createContentLedgerApiDocument(snapshot) }
  ];
}

