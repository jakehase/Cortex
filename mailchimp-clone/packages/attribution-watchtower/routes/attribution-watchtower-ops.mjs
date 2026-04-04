import { buildAttributionWatchtowerSnapshot, createAttributionWatchtowerReadinessBoard } from '../service-attribution-watchtower.mjs';

export function createAttributionWatchtowerOpsRoutes(basePath = '/ops/attribution-watchtower') {
  const snapshot = buildAttributionWatchtowerSnapshot();
  return [
    { id: 'attribution-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionWatchtowerReadinessBoard(snapshot) },
    { id: 'attribution-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

