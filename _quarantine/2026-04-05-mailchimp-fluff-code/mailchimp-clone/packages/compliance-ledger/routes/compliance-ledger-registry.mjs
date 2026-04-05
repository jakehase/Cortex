import { buildComplianceLedgerSnapshot, createComplianceLedgerRouteSummary } from '../service-compliance-ledger.mjs';

export function createComplianceLedgerRegistryRoutes(basePath = '/registry/compliance-ledger') {
  const snapshot = buildComplianceLedgerSnapshot();
  return [
    { id: 'compliance-ledger.registry.summary', method: 'GET', path: basePath, summary: createComplianceLedgerRouteSummary(snapshot) },
    { id: 'compliance-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

