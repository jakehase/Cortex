import { buildAudienceConsoleSnapshot, createAudienceConsoleReadinessBoard } from '../service-audience-console.mjs';

export function createAudienceConsoleOpsRoutes(basePath = '/ops/audience-console') {
  const snapshot = buildAudienceConsoleSnapshot();
  return [
    { id: 'audience-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceConsoleReadinessBoard(snapshot) },
    { id: 'audience-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

