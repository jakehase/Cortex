import { buildAdvocacyWorkbenchSnapshot, createAdvocacyWorkbenchReadinessBoard } from '../service-advocacy-workbench.mjs';

export function createAdvocacyWorkbenchOpsRoutes(basePath = '/ops/advocacy-workbench') {
  const snapshot = buildAdvocacyWorkbenchSnapshot();
  return [
    { id: 'advocacy-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyWorkbenchReadinessBoard(snapshot) },
    { id: 'advocacy-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

