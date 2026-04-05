import { buildBillingConsoleSnapshot, createBillingConsoleReadinessBoard } from '../service-billing-console.mjs';

export function createBillingConsoleOpsRoutes(basePath = '/ops/billing-console') {
  const snapshot = buildBillingConsoleSnapshot();
  return [
    { id: 'billing-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingConsoleReadinessBoard(snapshot) },
    { id: 'billing-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

