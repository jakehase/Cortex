import { buildActivationIndexSnapshot, createActivationIndexReadinessBoard } from '../service-activation-index.mjs';

export function createActivationIndexOpsRoutes(basePath = '/ops/activation-index') {
  const snapshot = buildActivationIndexSnapshot();
  return [
    { id: 'activation-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationIndexReadinessBoard(snapshot) },
    { id: 'activation-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

