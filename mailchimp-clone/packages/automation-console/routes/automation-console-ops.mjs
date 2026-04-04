import { buildAutomationConsoleSnapshot, createAutomationConsoleReadinessBoard } from '../service-automation-console.mjs';

export function createAutomationConsoleOpsRoutes(basePath = '/ops/automation-console') {
  const snapshot = buildAutomationConsoleSnapshot();
  return [
    { id: 'automation-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationConsoleReadinessBoard(snapshot) },
    { id: 'automation-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

