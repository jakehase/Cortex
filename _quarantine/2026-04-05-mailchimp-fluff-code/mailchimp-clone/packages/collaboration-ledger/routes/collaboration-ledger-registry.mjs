import { buildCollaborationLedgerSnapshot, createCollaborationLedgerRouteSummary } from '../service-collaboration-ledger.mjs';

export function createCollaborationLedgerRegistryRoutes(basePath = '/registry/collaboration-ledger') {
  const snapshot = buildCollaborationLedgerSnapshot();
  return [
    { id: 'collaboration-ledger.registry.summary', method: 'GET', path: basePath, summary: createCollaborationLedgerRouteSummary(snapshot) },
    { id: 'collaboration-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

