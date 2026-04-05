import { buildCustomerScorecardSnapshot, createCustomerScorecardReadinessBoard } from '../service-customer-scorecard.mjs';

export function createCustomerScorecardOpsRoutes(basePath = '/ops/customer-scorecard') {
  const snapshot = buildCustomerScorecardSnapshot();
  return [
    { id: 'customer-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerScorecardReadinessBoard(snapshot) },
    { id: 'customer-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

