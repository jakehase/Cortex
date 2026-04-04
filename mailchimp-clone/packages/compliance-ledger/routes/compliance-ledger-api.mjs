import { buildComplianceLedgerSnapshot, createComplianceLedgerApiDocument } from '../service-compliance-ledger.mjs';

export function createComplianceLedgerApiRoutes(basePath = '/api/compliance-ledger') {
  const snapshot = buildComplianceLedgerSnapshot();
  return [
    { id: 'compliance-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-ledger.api.document', method: 'GET', path: basePath + '/document', document: createComplianceLedgerApiDocument(snapshot) }
  ];
}

