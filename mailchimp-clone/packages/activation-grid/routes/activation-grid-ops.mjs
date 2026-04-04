import { buildActivationGridSnapshot, createActivationGridReadinessBoard } from '../service-activation-grid.mjs';

export function createActivationGridOpsRoutes(basePath = '/ops/activation-grid') {
  const snapshot = buildActivationGridSnapshot();
  return [
    { id: 'activation-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationGridReadinessBoard(snapshot) },
    { id: 'activation-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

