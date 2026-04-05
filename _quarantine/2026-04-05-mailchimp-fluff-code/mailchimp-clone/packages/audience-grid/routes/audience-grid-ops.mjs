import { buildAudienceGridSnapshot, createAudienceGridReadinessBoard } from '../service-audience-grid.mjs';

export function createAudienceGridOpsRoutes(basePath = '/ops/audience-grid') {
  const snapshot = buildAudienceGridSnapshot();
  return [
    { id: 'audience-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceGridReadinessBoard(snapshot) },
    { id: 'audience-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

