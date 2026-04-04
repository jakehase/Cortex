import { buildLifecycleFoundrySnapshot, createLifecycleFoundryReadinessBoard } from '../service-lifecycle-foundry.mjs';

export function createLifecycleFoundryOpsRoutes(basePath = '/ops/lifecycle-foundry') {
  const snapshot = buildLifecycleFoundrySnapshot();
  return [
    { id: 'lifecycle-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleFoundryReadinessBoard(snapshot) },
    { id: 'lifecycle-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

