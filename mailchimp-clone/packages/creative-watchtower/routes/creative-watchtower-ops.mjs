import { buildCreativeWatchtowerSnapshot, createCreativeWatchtowerReadinessBoard } from '../service-creative-watchtower.mjs';

export function createCreativeWatchtowerOpsRoutes(basePath = '/ops/creative-watchtower') {
  const snapshot = buildCreativeWatchtowerSnapshot();
  return [
    { id: 'creative-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeWatchtowerReadinessBoard(snapshot) },
    { id: 'creative-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

