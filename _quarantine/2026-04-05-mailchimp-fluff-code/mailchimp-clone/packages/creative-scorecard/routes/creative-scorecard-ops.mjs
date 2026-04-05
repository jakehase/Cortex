import { buildCreativeScorecardSnapshot, createCreativeScorecardReadinessBoard } from '../service-creative-scorecard.mjs';

export function createCreativeScorecardOpsRoutes(basePath = '/ops/creative-scorecard') {
  const snapshot = buildCreativeScorecardSnapshot();
  return [
    { id: 'creative-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeScorecardReadinessBoard(snapshot) },
    { id: 'creative-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

