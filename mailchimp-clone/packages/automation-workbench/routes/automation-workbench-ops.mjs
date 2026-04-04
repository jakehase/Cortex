import { buildAutomationWorkbenchSnapshot, createAutomationWorkbenchReadinessBoard } from '../service-automation-workbench.mjs';

export function createAutomationWorkbenchOpsRoutes(basePath = '/ops/automation-workbench') {
  const snapshot = buildAutomationWorkbenchSnapshot();
  return [
    { id: 'automation-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationWorkbenchReadinessBoard(snapshot) },
    { id: 'automation-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

