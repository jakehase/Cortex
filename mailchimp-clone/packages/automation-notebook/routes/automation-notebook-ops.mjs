import { buildAutomationNotebookSnapshot, createAutomationNotebookReadinessBoard } from '../service-automation-notebook.mjs';

export function createAutomationNotebookOpsRoutes(basePath = '/ops/automation-notebook') {
  const snapshot = buildAutomationNotebookSnapshot();
  return [
    { id: 'automation-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationNotebookReadinessBoard(snapshot) },
    { id: 'automation-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

