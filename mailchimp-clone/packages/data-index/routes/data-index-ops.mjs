import { buildDataIndexSnapshot, createDataIndexReadinessBoard } from '../service-data-index.mjs';

export function createDataIndexOpsRoutes(basePath = '/ops/data-index') {
  const snapshot = buildDataIndexSnapshot();
  return [
    { id: 'data-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataIndexReadinessBoard(snapshot) },
    { id: 'data-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

