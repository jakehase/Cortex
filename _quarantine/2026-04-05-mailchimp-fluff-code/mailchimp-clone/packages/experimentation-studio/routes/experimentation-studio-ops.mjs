import { buildExperimentationStudioSnapshot, createExperimentationStudioReadinessBoard } from '../service-experimentation-studio.mjs';

export function createExperimentationStudioOpsRoutes(basePath = '/ops/experimentation-studio') {
  const snapshot = buildExperimentationStudioSnapshot();
  return [
    { id: 'experimentation-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationStudioReadinessBoard(snapshot) },
    { id: 'experimentation-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

