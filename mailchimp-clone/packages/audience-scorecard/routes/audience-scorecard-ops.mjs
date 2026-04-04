import { buildAudienceScorecardSnapshot, createAudienceScorecardReadinessBoard } from '../service-audience-scorecard.mjs';

export function createAudienceScorecardOpsRoutes(basePath = '/ops/audience-scorecard') {
  const snapshot = buildAudienceScorecardSnapshot();
  return [
    { id: 'audience-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceScorecardReadinessBoard(snapshot) },
    { id: 'audience-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

