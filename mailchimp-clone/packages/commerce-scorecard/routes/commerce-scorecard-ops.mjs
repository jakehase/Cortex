import { buildCommerceScorecardSnapshot, createCommerceScorecardReadinessBoard } from '../service-commerce-scorecard.mjs';

export function createCommerceScorecardOpsRoutes(basePath = '/ops/commerce-scorecard') {
  const snapshot = buildCommerceScorecardSnapshot();
  return [
    { id: 'commerce-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceScorecardReadinessBoard(snapshot) },
    { id: 'commerce-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

