import { buildAnalyticsLedgerSnapshot, createAnalyticsLedgerRouteSummary } from '../service-analytics-ledger.mjs';

export function createAnalyticsLedgerRegistryRoutes(basePath = '/registry/analytics-ledger') {
  const snapshot = buildAnalyticsLedgerSnapshot();
  return [
    { id: 'analytics-ledger.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsLedgerRouteSummary(snapshot) },
    { id: 'analytics-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

