import { buildActivationScorecardSnapshot, createActivationScorecardReadinessBoard } from '../service-activation-scorecard.mjs';

export function createActivationScorecardOpsRoutes(basePath = '/ops/activation-scorecard') {
  const snapshot = buildActivationScorecardSnapshot();
  return [
    { id: 'activation-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationScorecardReadinessBoard(snapshot) },
    { id: 'activation-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

