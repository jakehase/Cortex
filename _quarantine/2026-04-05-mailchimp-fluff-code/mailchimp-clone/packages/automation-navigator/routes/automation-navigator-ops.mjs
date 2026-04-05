import { buildAutomationNavigatorSnapshot, createAutomationNavigatorReadinessBoard } from '../service-automation-navigator.mjs';

export function createAutomationNavigatorOpsRoutes(basePath = '/ops/automation-navigator') {
  const snapshot = buildAutomationNavigatorSnapshot();
  return [
    { id: 'automation-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationNavigatorReadinessBoard(snapshot) },
    { id: 'automation-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

