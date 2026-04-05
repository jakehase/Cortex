import { buildInsightsLedgerSnapshot, createInsightsLedgerReadinessBoard } from '../service-insights-ledger.mjs';

export function createInsightsLedgerOpsRoutes(basePath = '/ops/insights-ledger') {
  const snapshot = buildInsightsLedgerSnapshot();
  return [
    { id: 'insights-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsLedgerReadinessBoard(snapshot) },
    { id: 'insights-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

