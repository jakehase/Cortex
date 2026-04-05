import { buildEcommerceLedgerSnapshot, createEcommerceLedgerRouteSummary } from '../service-ecommerce-ledger.mjs';

export function createEcommerceLedgerRegistryRoutes(basePath = '/registry/ecommerce-ledger') {
  const snapshot = buildEcommerceLedgerSnapshot();
  return [
    { id: 'ecommerce-ledger.registry.summary', method: 'GET', path: basePath, summary: createEcommerceLedgerRouteSummary(snapshot) },
    { id: 'ecommerce-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

