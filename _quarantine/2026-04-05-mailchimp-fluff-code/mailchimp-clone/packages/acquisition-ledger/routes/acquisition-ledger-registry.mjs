import { buildAcquisitionLedgerSnapshot, createAcquisitionLedgerRouteSummary } from '../service-acquisition-ledger.mjs';

export function createAcquisitionLedgerRegistryRoutes(basePath = '/registry/acquisition-ledger') {
  const snapshot = buildAcquisitionLedgerSnapshot();
  return [
    { id: 'acquisition-ledger.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionLedgerRouteSummary(snapshot) },
    { id: 'acquisition-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

