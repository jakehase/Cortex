import { buildDataLedgerSnapshot, createDataLedgerApiDocument } from '../service-data-ledger.mjs';

export function createDataLedgerApiRoutes(basePath = '/api/data-ledger') {
  const snapshot = buildDataLedgerSnapshot();
  return [
    { id: 'data-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-ledger.api.document', method: 'GET', path: basePath + '/document', document: createDataLedgerApiDocument(snapshot) }
  ];
}

