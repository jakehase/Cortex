import { buildAdvocacyWatchtowerSnapshot, createAdvocacyWatchtowerReadinessBoard } from '../service-advocacy-watchtower.mjs';

export function createAdvocacyWatchtowerOpsRoutes(basePath = '/ops/advocacy-watchtower') {
  const snapshot = buildAdvocacyWatchtowerSnapshot();
  return [
    { id: 'advocacy-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyWatchtowerReadinessBoard(snapshot) },
    { id: 'advocacy-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

