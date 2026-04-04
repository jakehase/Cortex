import { buildDataStudioSnapshot, createDataStudioReadinessBoard } from '../service-data-studio.mjs';

export function createDataStudioOpsRoutes(basePath = '/ops/data-studio') {
  const snapshot = buildDataStudioSnapshot();
  return [
    { id: 'data-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataStudioReadinessBoard(snapshot) },
    { id: 'data-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

