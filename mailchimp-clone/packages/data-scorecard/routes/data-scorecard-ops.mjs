import { buildDataScorecardSnapshot, createDataScorecardReadinessBoard } from '../service-data-scorecard.mjs';

export function createDataScorecardOpsRoutes(basePath = '/ops/data-scorecard') {
  const snapshot = buildDataScorecardSnapshot();
  return [
    { id: 'data-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataScorecardReadinessBoard(snapshot) },
    { id: 'data-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

