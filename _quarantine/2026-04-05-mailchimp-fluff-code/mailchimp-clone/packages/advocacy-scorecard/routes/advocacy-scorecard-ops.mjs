import { buildAdvocacyScorecardSnapshot, createAdvocacyScorecardReadinessBoard } from '../service-advocacy-scorecard.mjs';

export function createAdvocacyScorecardOpsRoutes(basePath = '/ops/advocacy-scorecard') {
  const snapshot = buildAdvocacyScorecardSnapshot();
  return [
    { id: 'advocacy-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyScorecardReadinessBoard(snapshot) },
    { id: 'advocacy-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

