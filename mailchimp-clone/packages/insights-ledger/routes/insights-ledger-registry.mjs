import { buildInsightsLedgerSnapshot, createInsightsLedgerRouteSummary } from '../service-insights-ledger.mjs';

export function createInsightsLedgerRegistryRoutes(basePath = '/registry/insights-ledger') {
  const snapshot = buildInsightsLedgerSnapshot();
  return [
    { id: 'insights-ledger.registry.summary', method: 'GET', path: basePath, summary: createInsightsLedgerRouteSummary(snapshot) },
    { id: 'insights-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

