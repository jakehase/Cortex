import { buildActivationLedgerSnapshot, createActivationLedgerRouteSummary } from '../service-activation-ledger.mjs';

export function createActivationLedgerRegistryRoutes(basePath = '/registry/activation-ledger') {
  const snapshot = buildActivationLedgerSnapshot();
  return [
    { id: 'activation-ledger.registry.summary', method: 'GET', path: basePath, summary: createActivationLedgerRouteSummary(snapshot) },
    { id: 'activation-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

