import { buildAcquisitionNotebookSnapshot, createAcquisitionNotebookReadinessBoard } from '../service-acquisition-notebook.mjs';

export function createAcquisitionNotebookOpsRoutes(basePath = '/ops/acquisition-notebook') {
  const snapshot = buildAcquisitionNotebookSnapshot();
  return [
    { id: 'acquisition-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionNotebookReadinessBoard(snapshot) },
    { id: 'acquisition-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

