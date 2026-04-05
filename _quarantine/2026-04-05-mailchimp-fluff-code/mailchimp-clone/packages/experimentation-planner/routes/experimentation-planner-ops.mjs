import { buildExperimentationPlannerSnapshot, createExperimentationPlannerReadinessBoard } from '../service-experimentation-planner.mjs';

export function createExperimentationPlannerOpsRoutes(basePath = '/ops/experimentation-planner') {
  const snapshot = buildExperimentationPlannerSnapshot();
  return [
    { id: 'experimentation-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationPlannerReadinessBoard(snapshot) },
    { id: 'experimentation-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

