import { buildActivationNavigatorSnapshot, createActivationNavigatorReadinessBoard } from '../service-activation-navigator.mjs';

export function createActivationNavigatorOpsRoutes(basePath = '/ops/activation-navigator') {
  const snapshot = buildActivationNavigatorSnapshot();
  return [
    { id: 'activation-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationNavigatorReadinessBoard(snapshot) },
    { id: 'activation-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

