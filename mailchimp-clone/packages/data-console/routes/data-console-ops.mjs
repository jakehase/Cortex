import { buildDataConsoleSnapshot, createDataConsoleReadinessBoard } from '../service-data-console.mjs';

export function createDataConsoleOpsRoutes(basePath = '/ops/data-console') {
  const snapshot = buildDataConsoleSnapshot();
  return [
    { id: 'data-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataConsoleReadinessBoard(snapshot) },
    { id: 'data-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

