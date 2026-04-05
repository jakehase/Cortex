import { buildLoyaltyScorecardSnapshot, createLoyaltyScorecardReadinessBoard } from '../service-loyalty-scorecard.mjs';

export function createLoyaltyScorecardOpsRoutes(basePath = '/ops/loyalty-scorecard') {
  const snapshot = buildLoyaltyScorecardSnapshot();
  return [
    { id: 'loyalty-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyScorecardReadinessBoard(snapshot) },
    { id: 'loyalty-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

