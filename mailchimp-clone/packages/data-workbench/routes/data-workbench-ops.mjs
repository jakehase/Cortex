import { buildDataWorkbenchSnapshot, createDataWorkbenchReadinessBoard } from '../service-data-workbench.mjs';

export function createDataWorkbenchOpsRoutes(basePath = '/ops/data-workbench') {
  const snapshot = buildDataWorkbenchSnapshot();
  return [
    { id: 'data-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataWorkbenchReadinessBoard(snapshot) },
    { id: 'data-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

