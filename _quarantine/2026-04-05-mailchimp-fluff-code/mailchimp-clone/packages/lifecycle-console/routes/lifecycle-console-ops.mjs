import { buildLifecycleConsoleSnapshot, createLifecycleConsoleReadinessBoard } from '../service-lifecycle-console.mjs';

export function createLifecycleConsoleOpsRoutes(basePath = '/ops/lifecycle-console') {
  const snapshot = buildLifecycleConsoleSnapshot();
  return [
    { id: 'lifecycle-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleConsoleReadinessBoard(snapshot) },
    { id: 'lifecycle-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

