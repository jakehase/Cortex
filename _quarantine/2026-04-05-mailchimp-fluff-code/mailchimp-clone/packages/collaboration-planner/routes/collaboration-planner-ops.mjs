import { buildCollaborationPlannerSnapshot, createCollaborationPlannerReadinessBoard } from '../service-collaboration-planner.mjs';

export function createCollaborationPlannerOpsRoutes(basePath = '/ops/collaboration-planner') {
  const snapshot = buildCollaborationPlannerSnapshot();
  return [
    { id: 'collaboration-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationPlannerReadinessBoard(snapshot) },
    { id: 'collaboration-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

