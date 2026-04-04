import { buildLifecycleScorecardSnapshot, createLifecycleScorecardReadinessBoard } from '../service-lifecycle-scorecard.mjs';

export function createLifecycleScorecardOpsRoutes(basePath = '/ops/lifecycle-scorecard') {
  const snapshot = buildLifecycleScorecardSnapshot();
  return [
    { id: 'lifecycle-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleScorecardReadinessBoard(snapshot) },
    { id: 'lifecycle-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

