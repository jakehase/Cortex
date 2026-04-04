import { buildDeliverabilityLedgerSnapshot, createDeliverabilityLedgerRouteSummary } from '../service-deliverability-ledger.mjs';

export function createDeliverabilityLedgerRegistryRoutes(basePath = '/registry/deliverability-ledger') {
  const snapshot = buildDeliverabilityLedgerSnapshot();
  return [
    { id: 'deliverability-ledger.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityLedgerRouteSummary(snapshot) },
    { id: 'deliverability-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

