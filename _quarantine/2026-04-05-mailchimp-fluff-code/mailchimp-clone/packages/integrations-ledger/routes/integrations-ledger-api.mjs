import { buildIntegrationsLedgerSnapshot, createIntegrationsLedgerApiDocument } from '../service-integrations-ledger.mjs';

export function createIntegrationsLedgerApiRoutes(basePath = '/api/integrations-ledger') {
  const snapshot = buildIntegrationsLedgerSnapshot();
  return [
    { id: 'integrations-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-ledger.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsLedgerApiDocument(snapshot) }
  ];
}

