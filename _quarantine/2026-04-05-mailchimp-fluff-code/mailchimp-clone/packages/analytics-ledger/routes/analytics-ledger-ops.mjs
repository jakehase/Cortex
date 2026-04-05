import { buildAnalyticsLedgerSnapshot, createAnalyticsLedgerReadinessBoard } from '../service-analytics-ledger.mjs';

export function createAnalyticsLedgerOpsRoutes(basePath = '/ops/analytics-ledger') {
  const snapshot = buildAnalyticsLedgerSnapshot();
  return [
    { id: 'analytics-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsLedgerReadinessBoard(snapshot) },
    { id: 'analytics-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

