import { buildAutomationPlannerSnapshot, createAutomationPlannerReadinessBoard } from '../service-automation-planner.mjs';

export function createAutomationPlannerOpsRoutes(basePath = '/ops/automation-planner') {
  const snapshot = buildAutomationPlannerSnapshot();
  return [
    { id: 'automation-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationPlannerReadinessBoard(snapshot) },
    { id: 'automation-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

