import { buildActivationStudioSnapshot, createActivationStudioReadinessBoard } from '../service-activation-studio.mjs';

export function createActivationStudioOpsRoutes(basePath = '/ops/activation-studio') {
  const snapshot = buildActivationStudioSnapshot();
  return [
    { id: 'activation-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationStudioReadinessBoard(snapshot) },
    { id: 'activation-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

