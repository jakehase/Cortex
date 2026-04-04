import { buildComplianceScorecardSnapshot, createComplianceScorecardReadinessBoard } from '../service-compliance-scorecard.mjs';

export function createComplianceScorecardOpsRoutes(basePath = '/ops/compliance-scorecard') {
  const snapshot = buildComplianceScorecardSnapshot();
  return [
    { id: 'compliance-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceScorecardReadinessBoard(snapshot) },
    { id: 'compliance-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

