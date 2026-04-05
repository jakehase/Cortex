import { buildDataGridSnapshot, createDataGridReadinessBoard } from '../service-data-grid.mjs';

export function createDataGridOpsRoutes(basePath = '/ops/data-grid') {
  const snapshot = buildDataGridSnapshot();
  return [
    { id: 'data-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataGridReadinessBoard(snapshot) },
    { id: 'data-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

