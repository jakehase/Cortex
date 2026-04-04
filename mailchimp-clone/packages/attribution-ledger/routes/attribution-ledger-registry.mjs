import { buildAttributionLedgerSnapshot, createAttributionLedgerRouteSummary } from '../service-attribution-ledger.mjs';

export function createAttributionLedgerRegistryRoutes(basePath = '/registry/attribution-ledger') {
  const snapshot = buildAttributionLedgerSnapshot();
  return [
    { id: 'attribution-ledger.registry.summary', method: 'GET', path: basePath, summary: createAttributionLedgerRouteSummary(snapshot) },
    { id: 'attribution-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

