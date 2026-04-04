import { buildAdvocacyConsoleSnapshot, createAdvocacyConsoleReadinessBoard } from '../service-advocacy-console.mjs';

export function createAdvocacyConsoleOpsRoutes(basePath = '/ops/advocacy-console') {
  const snapshot = buildAdvocacyConsoleSnapshot();
  return [
    { id: 'advocacy-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyConsoleReadinessBoard(snapshot) },
    { id: 'advocacy-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

