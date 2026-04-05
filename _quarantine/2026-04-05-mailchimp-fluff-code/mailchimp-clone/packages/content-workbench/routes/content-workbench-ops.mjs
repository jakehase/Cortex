import { buildContentWorkbenchSnapshot, createContentWorkbenchReadinessBoard } from '../service-content-workbench.mjs';

export function createContentWorkbenchOpsRoutes(basePath = '/ops/content-workbench') {
  const snapshot = buildContentWorkbenchSnapshot();
  return [
    { id: 'content-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentWorkbenchReadinessBoard(snapshot) },
    { id: 'content-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

