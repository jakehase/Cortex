import { buildAutomationFoundrySnapshot, createAutomationFoundryReadinessBoard } from '../service-automation-foundry.mjs';

export function createAutomationFoundryOpsRoutes(basePath = '/ops/automation-foundry') {
  const snapshot = buildAutomationFoundrySnapshot();
  return [
    { id: 'automation-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationFoundryReadinessBoard(snapshot) },
    { id: 'automation-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

