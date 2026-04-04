import { buildCommerceWatchtowerSnapshot, createCommerceWatchtowerReadinessBoard } from '../service-commerce-watchtower.mjs';

export function createCommerceWatchtowerOpsRoutes(basePath = '/ops/commerce-watchtower') {
  const snapshot = buildCommerceWatchtowerSnapshot();
  return [
    { id: 'commerce-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceWatchtowerReadinessBoard(snapshot) },
    { id: 'commerce-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

