import { buildContentScorecardSnapshot, createContentScorecardReadinessBoard } from '../service-content-scorecard.mjs';

export function createContentScorecardOpsRoutes(basePath = '/ops/content-scorecard') {
  const snapshot = buildContentScorecardSnapshot();
  return [
    { id: 'content-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentScorecardReadinessBoard(snapshot) },
    { id: 'content-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

