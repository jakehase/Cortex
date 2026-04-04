import { buildCreativeConsoleSnapshot, createCreativeConsoleReadinessBoard } from '../service-creative-console.mjs';

export function createCreativeConsoleOpsRoutes(basePath = '/ops/creative-console') {
  const snapshot = buildCreativeConsoleSnapshot();
  return [
    { id: 'creative-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeConsoleReadinessBoard(snapshot) },
    { id: 'creative-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

