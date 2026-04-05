import { buildAutomationStudioSnapshot, createAutomationStudioReadinessBoard } from '../service-automation-studio.mjs';

export function createAutomationStudioOpsRoutes(basePath = '/ops/automation-studio') {
  const snapshot = buildAutomationStudioSnapshot();
  return [
    { id: 'automation-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationStudioReadinessBoard(snapshot) },
    { id: 'automation-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

