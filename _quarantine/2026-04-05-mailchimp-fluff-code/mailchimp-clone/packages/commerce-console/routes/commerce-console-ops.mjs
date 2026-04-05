import { buildCommerceConsoleSnapshot, createCommerceConsoleReadinessBoard } from '../service-commerce-console.mjs';

export function createCommerceConsoleOpsRoutes(basePath = '/ops/commerce-console') {
  const snapshot = buildCommerceConsoleSnapshot();
  return [
    { id: 'commerce-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceConsoleReadinessBoard(snapshot) },
    { id: 'commerce-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

