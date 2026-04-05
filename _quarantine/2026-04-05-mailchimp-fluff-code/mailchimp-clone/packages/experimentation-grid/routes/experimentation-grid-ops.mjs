import { buildExperimentationGridSnapshot, createExperimentationGridReadinessBoard } from '../service-experimentation-grid.mjs';

export function createExperimentationGridOpsRoutes(basePath = '/ops/experimentation-grid') {
  const snapshot = buildExperimentationGridSnapshot();
  return [
    { id: 'experimentation-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationGridReadinessBoard(snapshot) },
    { id: 'experimentation-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

