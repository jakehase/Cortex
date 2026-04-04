import { buildAutomationSentinelSnapshot, createAutomationSentinelReadinessBoard } from '../service-automation-sentinel.mjs';

export function createAutomationSentinelOpsRoutes(basePath = '/ops/automation-sentinel') {
  const snapshot = buildAutomationSentinelSnapshot();
  return [
    { id: 'automation-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationSentinelReadinessBoard(snapshot) },
    { id: 'automation-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

