import { buildExperimentationNotebookSnapshot, createExperimentationNotebookReadinessBoard } from '../service-experimentation-notebook.mjs';

export function createExperimentationNotebookOpsRoutes(basePath = '/ops/experimentation-notebook') {
  const snapshot = buildExperimentationNotebookSnapshot();
  return [
    { id: 'experimentation-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationNotebookReadinessBoard(snapshot) },
    { id: 'experimentation-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

