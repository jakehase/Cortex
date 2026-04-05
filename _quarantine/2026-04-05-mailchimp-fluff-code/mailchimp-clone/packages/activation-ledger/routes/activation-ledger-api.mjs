import { buildActivationLedgerSnapshot, createActivationLedgerApiDocument } from '../service-activation-ledger.mjs';

export function createActivationLedgerApiRoutes(basePath = '/api/activation-ledger') {
  const snapshot = buildActivationLedgerSnapshot();
  return [
    { id: 'activation-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-ledger.api.document', method: 'GET', path: basePath + '/document', document: createActivationLedgerApiDocument(snapshot) }
  ];
}

