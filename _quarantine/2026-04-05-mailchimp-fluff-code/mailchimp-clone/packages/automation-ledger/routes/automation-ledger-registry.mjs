import { buildAutomationLedgerSnapshot, createAutomationLedgerRouteSummary } from '../service-automation-ledger.mjs';

export function createAutomationLedgerRegistryRoutes(basePath = '/registry/automation-ledger') {
  const snapshot = buildAutomationLedgerSnapshot();
  return [
    { id: 'automation-ledger.registry.summary', method: 'GET', path: basePath, summary: createAutomationLedgerRouteSummary(snapshot) },
    { id: 'automation-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

