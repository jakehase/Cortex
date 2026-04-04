import { buildContentConsoleSnapshot, createContentConsoleReadinessBoard } from '../service-content-console.mjs';

export function createContentConsoleOpsRoutes(basePath = '/ops/content-console') {
  const snapshot = buildContentConsoleSnapshot();
  return [
    { id: 'content-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentConsoleReadinessBoard(snapshot) },
    { id: 'content-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

