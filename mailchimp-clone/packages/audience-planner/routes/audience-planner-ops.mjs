import { buildAudiencePlannerSnapshot, createAudiencePlannerReadinessBoard } from '../service-audience-planner.mjs';

export function createAudiencePlannerOpsRoutes(basePath = '/ops/audience-planner') {
  const snapshot = buildAudiencePlannerSnapshot();
  return [
    { id: 'audience-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudiencePlannerReadinessBoard(snapshot) },
    { id: 'audience-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

