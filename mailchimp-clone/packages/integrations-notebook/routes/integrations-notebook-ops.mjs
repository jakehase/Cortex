import { buildIntegrationsNotebookSnapshot, createIntegrationsNotebookReadinessBoard } from '../service-integrations-notebook.mjs';

export function createIntegrationsNotebookOpsRoutes(basePath = '/ops/integrations-notebook') {
  const snapshot = buildIntegrationsNotebookSnapshot();
  return [
    { id: 'integrations-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsNotebookReadinessBoard(snapshot) },
    { id: 'integrations-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

