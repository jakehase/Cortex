import { buildAdvocacyGridSnapshot, createAdvocacyGridReadinessBoard } from '../service-advocacy-grid.mjs';

export function createAdvocacyGridOpsRoutes(basePath = '/ops/advocacy-grid') {
  const snapshot = buildAdvocacyGridSnapshot();
  return [
    { id: 'advocacy-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyGridReadinessBoard(snapshot) },
    { id: 'advocacy-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

