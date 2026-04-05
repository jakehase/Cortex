import { buildBillingLedgerSnapshot, createBillingLedgerRouteSummary } from '../service-billing-ledger.mjs';

export function createBillingLedgerRegistryRoutes(basePath = '/registry/billing-ledger') {
  const snapshot = buildBillingLedgerSnapshot();
  return [
    { id: 'billing-ledger.registry.summary', method: 'GET', path: basePath, summary: createBillingLedgerRouteSummary(snapshot) },
    { id: 'billing-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

