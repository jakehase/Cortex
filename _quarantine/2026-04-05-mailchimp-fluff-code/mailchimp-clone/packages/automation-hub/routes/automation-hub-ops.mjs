import { buildAutomationHubSnapshot, createAutomationHubReadinessBoard } from '../service-automation-hub.mjs';

export function createAutomationHubOpsRoutes(basePath = '/ops/automation-hub') {
  const snapshot = buildAutomationHubSnapshot();
  return [
    { id: 'automation-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationHubReadinessBoard(snapshot) },
    { id: 'automation-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

