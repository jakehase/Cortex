import { buildActivationConsoleSnapshot, createActivationConsoleReadinessBoard } from '../service-activation-console.mjs';

export function createActivationConsoleOpsRoutes(basePath = '/ops/activation-console') {
  const snapshot = buildActivationConsoleSnapshot();
  return [
    { id: 'activation-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationConsoleReadinessBoard(snapshot) },
    { id: 'activation-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

