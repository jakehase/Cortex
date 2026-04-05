import { buildActivationPlannerSnapshot, createActivationPlannerReadinessBoard } from '../service-activation-planner.mjs';

export function createActivationPlannerOpsRoutes(basePath = '/ops/activation-planner') {
  const snapshot = buildActivationPlannerSnapshot();
  return [
    { id: 'activation-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationPlannerReadinessBoard(snapshot) },
    { id: 'activation-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

