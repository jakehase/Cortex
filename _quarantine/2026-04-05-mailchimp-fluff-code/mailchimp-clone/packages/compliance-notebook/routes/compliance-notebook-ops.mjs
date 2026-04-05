import { buildComplianceNotebookSnapshot, createComplianceNotebookReadinessBoard } from '../service-compliance-notebook.mjs';

export function createComplianceNotebookOpsRoutes(basePath = '/ops/compliance-notebook') {
  const snapshot = buildComplianceNotebookSnapshot();
  return [
    { id: 'compliance-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceNotebookReadinessBoard(snapshot) },
    { id: 'compliance-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

