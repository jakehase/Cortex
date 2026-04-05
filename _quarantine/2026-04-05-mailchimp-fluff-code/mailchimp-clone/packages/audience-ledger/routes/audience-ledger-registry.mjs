import { buildAudienceLedgerSnapshot, createAudienceLedgerRouteSummary } from '../service-audience-ledger.mjs';

export function createAudienceLedgerRegistryRoutes(basePath = '/registry/audience-ledger') {
  const snapshot = buildAudienceLedgerSnapshot();
  return [
    { id: 'audience-ledger.registry.summary', method: 'GET', path: basePath, summary: createAudienceLedgerRouteSummary(snapshot) },
    { id: 'audience-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

