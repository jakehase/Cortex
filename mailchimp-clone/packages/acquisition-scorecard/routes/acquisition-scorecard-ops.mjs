import { buildAcquisitionScorecardSnapshot, createAcquisitionScorecardReadinessBoard } from '../service-acquisition-scorecard.mjs';

export function createAcquisitionScorecardOpsRoutes(basePath = '/ops/acquisition-scorecard') {
  const snapshot = buildAcquisitionScorecardSnapshot();
  return [
    { id: 'acquisition-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionScorecardReadinessBoard(snapshot) },
    { id: 'acquisition-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

