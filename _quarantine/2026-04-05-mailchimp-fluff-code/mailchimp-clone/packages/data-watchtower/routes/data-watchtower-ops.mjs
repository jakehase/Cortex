import { buildDataWatchtowerSnapshot, createDataWatchtowerReadinessBoard } from '../service-data-watchtower.mjs';

export function createDataWatchtowerOpsRoutes(basePath = '/ops/data-watchtower') {
  const snapshot = buildDataWatchtowerSnapshot();
  return [
    { id: 'data-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataWatchtowerReadinessBoard(snapshot) },
    { id: 'data-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

