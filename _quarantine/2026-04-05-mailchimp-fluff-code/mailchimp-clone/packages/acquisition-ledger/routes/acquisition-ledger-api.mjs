import { buildAcquisitionLedgerSnapshot, createAcquisitionLedgerApiDocument } from '../service-acquisition-ledger.mjs';

export function createAcquisitionLedgerApiRoutes(basePath = '/api/acquisition-ledger') {
  const snapshot = buildAcquisitionLedgerSnapshot();
  return [
    { id: 'acquisition-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-ledger.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionLedgerApiDocument(snapshot) }
  ];
}

