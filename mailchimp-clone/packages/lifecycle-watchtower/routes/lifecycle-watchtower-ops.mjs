import { buildLifecycleWatchtowerSnapshot, createLifecycleWatchtowerReadinessBoard } from '../service-lifecycle-watchtower.mjs';

export function createLifecycleWatchtowerOpsRoutes(basePath = '/ops/lifecycle-watchtower') {
  const snapshot = buildLifecycleWatchtowerSnapshot();
  return [
    { id: 'lifecycle-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleWatchtowerReadinessBoard(snapshot) },
    { id: 'lifecycle-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

