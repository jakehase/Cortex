import { buildAttributionScorecardSnapshot, createAttributionScorecardReadinessBoard } from '../service-attribution-scorecard.mjs';

export function createAttributionScorecardOpsRoutes(basePath = '/ops/attribution-scorecard') {
  const snapshot = buildAttributionScorecardSnapshot();
  return [
    { id: 'attribution-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionScorecardReadinessBoard(snapshot) },
    { id: 'attribution-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

