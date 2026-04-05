import { buildCreativeLedgerSnapshot, createCreativeLedgerApiDocument } from '../service-creative-ledger.mjs';

export function createCreativeLedgerApiRoutes(basePath = '/api/creative-ledger') {
  const snapshot = buildCreativeLedgerSnapshot();
  return [
    { id: 'creative-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-ledger.api.document', method: 'GET', path: basePath + '/document', document: createCreativeLedgerApiDocument(snapshot) }
  ];
}

