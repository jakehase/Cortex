import { buildCommerceLedgerSnapshot, createCommerceLedgerRouteSummary } from '../service-commerce-ledger.mjs';

export function createCommerceLedgerRegistryRoutes(basePath = '/registry/commerce-ledger') {
  const snapshot = buildCommerceLedgerSnapshot();
  return [
    { id: 'commerce-ledger.registry.summary', method: 'GET', path: basePath, summary: createCommerceLedgerRouteSummary(snapshot) },
    { id: 'commerce-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

