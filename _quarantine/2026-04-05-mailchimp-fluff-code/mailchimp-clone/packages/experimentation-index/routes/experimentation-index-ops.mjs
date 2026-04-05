import { buildExperimentationIndexSnapshot, createExperimentationIndexReadinessBoard } from '../service-experimentation-index.mjs';

export function createExperimentationIndexOpsRoutes(basePath = '/ops/experimentation-index') {
  const snapshot = buildExperimentationIndexSnapshot();
  return [
    { id: 'experimentation-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationIndexReadinessBoard(snapshot) },
    { id: 'experimentation-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

