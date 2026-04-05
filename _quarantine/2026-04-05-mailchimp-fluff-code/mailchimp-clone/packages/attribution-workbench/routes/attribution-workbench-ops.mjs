import { buildAttributionWorkbenchSnapshot, createAttributionWorkbenchReadinessBoard } from '../service-attribution-workbench.mjs';

export function createAttributionWorkbenchOpsRoutes(basePath = '/ops/attribution-workbench') {
  const snapshot = buildAttributionWorkbenchSnapshot();
  return [
    { id: 'attribution-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionWorkbenchReadinessBoard(snapshot) },
    { id: 'attribution-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

