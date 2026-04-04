import { buildIntegrationsLedgerSnapshot, createIntegrationsLedgerRouteSummary } from '../service-integrations-ledger.mjs';

export function createIntegrationsLedgerRegistryRoutes(basePath = '/registry/integrations-ledger') {
  const snapshot = buildIntegrationsLedgerSnapshot();
  return [
    { id: 'integrations-ledger.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsLedgerRouteSummary(snapshot) },
    { id: 'integrations-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

