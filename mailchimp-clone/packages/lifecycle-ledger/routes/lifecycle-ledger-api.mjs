import { buildLifecycleLedgerSnapshot, createLifecycleLedgerApiDocument } from '../service-lifecycle-ledger.mjs';

export function createLifecycleLedgerApiRoutes(basePath = '/api/lifecycle-ledger') {
  const snapshot = buildLifecycleLedgerSnapshot();
  return [
    { id: 'lifecycle-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-ledger.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleLedgerApiDocument(snapshot) }
  ];
}

