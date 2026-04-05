import { buildAutomationLedgerSnapshot, createAutomationLedgerApiDocument } from '../service-automation-ledger.mjs';

export function createAutomationLedgerApiRoutes(basePath = '/api/automation-ledger') {
  const snapshot = buildAutomationLedgerSnapshot();
  return [
    { id: 'automation-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-ledger.api.document', method: 'GET', path: basePath + '/document', document: createAutomationLedgerApiDocument(snapshot) }
  ];
}

