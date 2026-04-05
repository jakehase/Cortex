import { buildLifecycleWorkbenchSnapshot, createLifecycleWorkbenchReadinessBoard } from '../service-lifecycle-workbench.mjs';

export function createLifecycleWorkbenchOpsRoutes(basePath = '/ops/lifecycle-workbench') {
  const snapshot = buildLifecycleWorkbenchSnapshot();
  return [
    { id: 'lifecycle-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleWorkbenchReadinessBoard(snapshot) },
    { id: 'lifecycle-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

