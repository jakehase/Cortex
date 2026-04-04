import { buildAutomationAdvisorSnapshot, createAutomationAdvisorReadinessBoard } from '../service-automation-advisor.mjs';

export function createAutomationAdvisorOpsRoutes(basePath = '/ops/automation-advisor') {
  const snapshot = buildAutomationAdvisorSnapshot();
  return [
    { id: 'automation-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationAdvisorReadinessBoard(snapshot) },
    { id: 'automation-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

