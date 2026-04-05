import { buildAutomationWatchtowerSnapshot, createAutomationWatchtowerReadinessBoard } from '../service-automation-watchtower.mjs';

export function createAutomationWatchtowerOpsRoutes(basePath = '/ops/automation-watchtower') {
  const snapshot = buildAutomationWatchtowerSnapshot();
  return [
    { id: 'automation-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationWatchtowerReadinessBoard(snapshot) },
    { id: 'automation-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

