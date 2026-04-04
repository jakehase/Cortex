import { buildExperimentationNavigatorSnapshot, createExperimentationNavigatorReadinessBoard } from '../service-experimentation-navigator.mjs';

export function createExperimentationNavigatorOpsRoutes(basePath = '/ops/experimentation-navigator') {
  const snapshot = buildExperimentationNavigatorSnapshot();
  return [
    { id: 'experimentation-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationNavigatorReadinessBoard(snapshot) },
    { id: 'experimentation-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

