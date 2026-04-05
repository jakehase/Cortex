import { buildAutomationCockpitSnapshot, createAutomationCockpitReadinessBoard } from '../service-automation-cockpit.mjs';

export function createAutomationCockpitOpsRoutes(basePath = '/ops/automation-cockpit') {
  const snapshot = buildAutomationCockpitSnapshot();
  return [
    { id: 'automation-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationCockpitReadinessBoard(snapshot) },
    { id: 'automation-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

