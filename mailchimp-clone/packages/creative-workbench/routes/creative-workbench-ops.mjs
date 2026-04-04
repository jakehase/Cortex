import { buildCreativeWorkbenchSnapshot, createCreativeWorkbenchReadinessBoard } from '../service-creative-workbench.mjs';

export function createCreativeWorkbenchOpsRoutes(basePath = '/ops/creative-workbench') {
  const snapshot = buildCreativeWorkbenchSnapshot();
  return [
    { id: 'creative-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeWorkbenchReadinessBoard(snapshot) },
    { id: 'creative-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

