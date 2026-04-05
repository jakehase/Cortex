import { buildCreativeLedgerSnapshot, createCreativeLedgerRouteSummary } from '../service-creative-ledger.mjs';

export function createCreativeLedgerRegistryRoutes(basePath = '/registry/creative-ledger') {
  const snapshot = buildCreativeLedgerSnapshot();
  return [
    { id: 'creative-ledger.registry.summary', method: 'GET', path: basePath, summary: createCreativeLedgerRouteSummary(snapshot) },
    { id: 'creative-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

