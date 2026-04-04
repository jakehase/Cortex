import { buildLifecycleHubSnapshot, createLifecycleHubReadinessBoard } from '../service-lifecycle-hub.mjs';

export function createLifecycleHubOpsRoutes(basePath = '/ops/lifecycle-hub') {
  const snapshot = buildLifecycleHubSnapshot();
  return [
    { id: 'lifecycle-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleHubReadinessBoard(snapshot) },
    { id: 'lifecycle-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

