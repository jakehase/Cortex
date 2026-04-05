import { buildDeliverabilityNotebookSnapshot, createDeliverabilityNotebookReadinessBoard } from '../service-deliverability-notebook.mjs';

export function createDeliverabilityNotebookOpsRoutes(basePath = '/ops/deliverability-notebook') {
  const snapshot = buildDeliverabilityNotebookSnapshot();
  return [
    { id: 'deliverability-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityNotebookReadinessBoard(snapshot) },
    { id: 'deliverability-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

