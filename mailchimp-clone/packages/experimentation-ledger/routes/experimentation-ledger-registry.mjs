import { buildExperimentationLedgerSnapshot, createExperimentationLedgerRouteSummary } from '../service-experimentation-ledger.mjs';

export function createExperimentationLedgerRegistryRoutes(basePath = '/registry/experimentation-ledger') {
  const snapshot = buildExperimentationLedgerSnapshot();
  return [
    { id: 'experimentation-ledger.registry.summary', method: 'GET', path: basePath, summary: createExperimentationLedgerRouteSummary(snapshot) },
    { id: 'experimentation-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

