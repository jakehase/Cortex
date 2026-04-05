import { buildAutomationIndexSnapshot, createAutomationIndexReadinessBoard } from '../service-automation-index.mjs';

export function createAutomationIndexOpsRoutes(basePath = '/ops/automation-index') {
  const snapshot = buildAutomationIndexSnapshot();
  return [
    { id: 'automation-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationIndexReadinessBoard(snapshot) },
    { id: 'automation-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

