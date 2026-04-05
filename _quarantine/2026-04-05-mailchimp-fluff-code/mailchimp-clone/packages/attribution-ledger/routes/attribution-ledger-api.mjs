import { buildAttributionLedgerSnapshot, createAttributionLedgerApiDocument } from '../service-attribution-ledger.mjs';

export function createAttributionLedgerApiRoutes(basePath = '/api/attribution-ledger') {
  const snapshot = buildAttributionLedgerSnapshot();
  return [
    { id: 'attribution-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-ledger.api.document', method: 'GET', path: basePath + '/document', document: createAttributionLedgerApiDocument(snapshot) }
  ];
}

