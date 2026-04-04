import { buildAudienceIndexSnapshot, createAudienceIndexReadinessBoard } from '../service-audience-index.mjs';

export function createAudienceIndexOpsRoutes(basePath = '/ops/audience-index') {
  const snapshot = buildAudienceIndexSnapshot();
  return [
    { id: 'audience-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceIndexReadinessBoard(snapshot) },
    { id: 'audience-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

