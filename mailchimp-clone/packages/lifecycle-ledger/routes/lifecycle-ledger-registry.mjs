import { buildLifecycleLedgerSnapshot, createLifecycleLedgerRouteSummary } from '../service-lifecycle-ledger.mjs';

export function createLifecycleLedgerRegistryRoutes(basePath = '/registry/lifecycle-ledger') {
  const snapshot = buildLifecycleLedgerSnapshot();
  return [
    { id: 'lifecycle-ledger.registry.summary', method: 'GET', path: basePath, summary: createLifecycleLedgerRouteSummary(snapshot) },
    { id: 'lifecycle-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

