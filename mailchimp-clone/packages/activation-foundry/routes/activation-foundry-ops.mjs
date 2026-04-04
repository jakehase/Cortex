import { buildActivationFoundrySnapshot, createActivationFoundryReadinessBoard } from '../service-activation-foundry.mjs';

export function createActivationFoundryOpsRoutes(basePath = '/ops/activation-foundry') {
  const snapshot = buildActivationFoundrySnapshot();
  return [
    { id: 'activation-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationFoundryReadinessBoard(snapshot) },
    { id: 'activation-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

