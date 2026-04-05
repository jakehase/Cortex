import { buildAutomationScorecardSnapshot, createAutomationScorecardReadinessBoard } from '../service-automation-scorecard.mjs';

export function createAutomationScorecardOpsRoutes(basePath = '/ops/automation-scorecard') {
  const snapshot = buildAutomationScorecardSnapshot();
  return [
    { id: 'automation-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationScorecardReadinessBoard(snapshot) },
    { id: 'automation-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

