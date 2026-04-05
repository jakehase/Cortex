import { buildAutomationExchangeSnapshot, createAutomationExchangeReadinessBoard } from '../service-automation-exchange.mjs';

export function createAutomationExchangeOpsRoutes(basePath = '/ops/automation-exchange') {
  const snapshot = buildAutomationExchangeSnapshot();
  return [
    { id: 'automation-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationExchangeReadinessBoard(snapshot) },
    { id: 'automation-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

