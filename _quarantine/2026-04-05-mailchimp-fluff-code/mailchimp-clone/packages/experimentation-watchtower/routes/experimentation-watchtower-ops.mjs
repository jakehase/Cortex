import { buildExperimentationWatchtowerSnapshot, createExperimentationWatchtowerReadinessBoard } from '../service-experimentation-watchtower.mjs';

export function createExperimentationWatchtowerOpsRoutes(basePath = '/ops/experimentation-watchtower') {
  const snapshot = buildExperimentationWatchtowerSnapshot();
  return [
    { id: 'experimentation-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationWatchtowerReadinessBoard(snapshot) },
    { id: 'experimentation-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

