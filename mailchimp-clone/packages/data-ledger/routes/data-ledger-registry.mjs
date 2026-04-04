import { buildDataLedgerSnapshot, createDataLedgerRouteSummary } from '../service-data-ledger.mjs';

export function createDataLedgerRegistryRoutes(basePath = '/registry/data-ledger') {
  const snapshot = buildDataLedgerSnapshot();
  return [
    { id: 'data-ledger.registry.summary', method: 'GET', path: basePath, summary: createDataLedgerRouteSummary(snapshot) },
    { id: 'data-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

