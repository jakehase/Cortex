import { buildDeliverabilityPlannerSnapshot, createDeliverabilityPlannerReadinessBoard } from '../service-deliverability-planner.mjs';

export function createDeliverabilityPlannerOpsRoutes(basePath = '/ops/deliverability-planner') {
  const snapshot = buildDeliverabilityPlannerSnapshot();
  return [
    { id: 'deliverability-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityPlannerReadinessBoard(snapshot) },
    { id: 'deliverability-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

