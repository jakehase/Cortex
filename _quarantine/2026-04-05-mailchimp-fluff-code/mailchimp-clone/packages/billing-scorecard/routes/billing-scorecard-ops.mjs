import { buildBillingScorecardSnapshot, createBillingScorecardReadinessBoard } from '../service-billing-scorecard.mjs';

export function createBillingScorecardOpsRoutes(basePath = '/ops/billing-scorecard') {
  const snapshot = buildBillingScorecardSnapshot();
  return [
    { id: 'billing-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingScorecardReadinessBoard(snapshot) },
    { id: 'billing-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

