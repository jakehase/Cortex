import { buildAudienceLedgerSnapshot, createAudienceLedgerApiDocument } from '../service-audience-ledger.mjs';

export function createAudienceLedgerApiRoutes(basePath = '/api/audience-ledger') {
  const snapshot = buildAudienceLedgerSnapshot();
  return [
    { id: 'audience-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-ledger.api.document', method: 'GET', path: basePath + '/document', document: createAudienceLedgerApiDocument(snapshot) }
  ];
}

