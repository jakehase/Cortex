import { buildLoyaltyLedgerSnapshot, createLoyaltyLedgerRouteSummary } from '../service-loyalty-ledger.mjs';

export function createLoyaltyLedgerRegistryRoutes(basePath = '/registry/loyalty-ledger') {
  const snapshot = buildLoyaltyLedgerSnapshot();
  return [
    { id: 'loyalty-ledger.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyLedgerRouteSummary(snapshot) },
    { id: 'loyalty-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

