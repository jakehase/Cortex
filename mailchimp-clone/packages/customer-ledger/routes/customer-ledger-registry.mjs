import { buildCustomerLedgerSnapshot, createCustomerLedgerRouteSummary } from '../service-customer-ledger.mjs';

export function createCustomerLedgerRegistryRoutes(basePath = '/registry/customer-ledger') {
  const snapshot = buildCustomerLedgerSnapshot();
  return [
    { id: 'customer-ledger.registry.summary', method: 'GET', path: basePath, summary: createCustomerLedgerRouteSummary(snapshot) },
    { id: 'customer-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

