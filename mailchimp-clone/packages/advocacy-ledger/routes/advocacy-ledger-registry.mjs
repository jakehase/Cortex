import { buildAdvocacyLedgerSnapshot, createAdvocacyLedgerRouteSummary } from '../service-advocacy-ledger.mjs';

export function createAdvocacyLedgerRegistryRoutes(basePath = '/registry/advocacy-ledger') {
  const snapshot = buildAdvocacyLedgerSnapshot();
  return [
    { id: 'advocacy-ledger.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyLedgerRouteSummary(snapshot) },
    { id: 'advocacy-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

