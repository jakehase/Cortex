import { buildAutomationGridSnapshot, createAutomationGridReadinessBoard } from '../service-automation-grid.mjs';

export function createAutomationGridOpsRoutes(basePath = '/ops/automation-grid') {
  const snapshot = buildAutomationGridSnapshot();
  return [
    { id: 'automation-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationGridReadinessBoard(snapshot) },
    { id: 'automation-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

