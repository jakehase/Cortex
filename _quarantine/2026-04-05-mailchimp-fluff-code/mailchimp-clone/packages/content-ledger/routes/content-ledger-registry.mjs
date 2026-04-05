import { buildContentLedgerSnapshot, createContentLedgerRouteSummary } from '../service-content-ledger.mjs';

export function createContentLedgerRegistryRoutes(basePath = '/registry/content-ledger') {
  const snapshot = buildContentLedgerSnapshot();
  return [
    { id: 'content-ledger.registry.summary', method: 'GET', path: basePath, summary: createContentLedgerRouteSummary(snapshot) },
    { id: 'content-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

