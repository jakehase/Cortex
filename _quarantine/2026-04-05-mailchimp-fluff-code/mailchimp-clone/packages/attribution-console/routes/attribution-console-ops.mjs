import { buildAttributionConsoleSnapshot, createAttributionConsoleReadinessBoard } from '../service-attribution-console.mjs';

export function createAttributionConsoleOpsRoutes(basePath = '/ops/attribution-console') {
  const snapshot = buildAttributionConsoleSnapshot();
  return [
    { id: 'attribution-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionConsoleReadinessBoard(snapshot) },
    { id: 'attribution-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

