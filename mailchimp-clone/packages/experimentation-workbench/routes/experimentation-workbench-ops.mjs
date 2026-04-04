import { buildExperimentationWorkbenchSnapshot, createExperimentationWorkbenchReadinessBoard } from '../service-experimentation-workbench.mjs';

export function createExperimentationWorkbenchOpsRoutes(basePath = '/ops/experimentation-workbench') {
  const snapshot = buildExperimentationWorkbenchSnapshot();
  return [
    { id: 'experimentation-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationWorkbenchReadinessBoard(snapshot) },
    { id: 'experimentation-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

