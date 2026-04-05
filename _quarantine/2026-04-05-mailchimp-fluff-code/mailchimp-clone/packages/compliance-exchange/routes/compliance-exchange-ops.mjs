import { buildComplianceExchangeSnapshot, createComplianceExchangeReadinessBoard } from '../service-compliance-exchange.mjs';

export function createComplianceExchangeOpsRoutes(basePath = '/ops/compliance-exchange') {
  const snapshot = buildComplianceExchangeSnapshot();
  return [
    { id: 'compliance-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceExchangeReadinessBoard(snapshot) },
    { id: 'compliance-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

