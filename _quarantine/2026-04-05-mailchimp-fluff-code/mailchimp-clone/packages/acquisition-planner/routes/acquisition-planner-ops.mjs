import { buildAcquisitionPlannerSnapshot, createAcquisitionPlannerReadinessBoard } from '../service-acquisition-planner.mjs';

export function createAcquisitionPlannerOpsRoutes(basePath = '/ops/acquisition-planner') {
  const snapshot = buildAcquisitionPlannerSnapshot();
  return [
    { id: 'acquisition-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionPlannerReadinessBoard(snapshot) },
    { id: 'acquisition-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

