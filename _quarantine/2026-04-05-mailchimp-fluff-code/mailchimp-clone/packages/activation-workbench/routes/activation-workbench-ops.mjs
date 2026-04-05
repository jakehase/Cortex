import { buildActivationWorkbenchSnapshot, createActivationWorkbenchReadinessBoard } from '../service-activation-workbench.mjs';

export function createActivationWorkbenchOpsRoutes(basePath = '/ops/activation-workbench') {
  const snapshot = buildActivationWorkbenchSnapshot();
  return [
    { id: 'activation-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationWorkbenchReadinessBoard(snapshot) },
    { id: 'activation-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

