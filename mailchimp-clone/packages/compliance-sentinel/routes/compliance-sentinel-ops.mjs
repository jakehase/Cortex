import { buildComplianceSentinelSnapshot, createComplianceSentinelReadinessBoard } from '../service-compliance-sentinel.mjs';

export function createComplianceSentinelOpsRoutes(basePath = '/ops/compliance-sentinel') {
  const snapshot = buildComplianceSentinelSnapshot();
  return [
    { id: 'compliance-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceSentinelReadinessBoard(snapshot) },
    { id: 'compliance-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

