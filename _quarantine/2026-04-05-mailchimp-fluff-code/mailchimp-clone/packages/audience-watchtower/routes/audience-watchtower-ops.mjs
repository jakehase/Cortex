import { buildAudienceWatchtowerSnapshot, createAudienceWatchtowerReadinessBoard } from '../service-audience-watchtower.mjs';

export function createAudienceWatchtowerOpsRoutes(basePath = '/ops/audience-watchtower') {
  const snapshot = buildAudienceWatchtowerSnapshot();
  return [
    { id: 'audience-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceWatchtowerReadinessBoard(snapshot) },
    { id: 'audience-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

