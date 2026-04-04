import { buildAudienceNavigatorSnapshot, createAudienceNavigatorReadinessBoard } from '../service-audience-navigator.mjs';

export function createAudienceNavigatorOpsRoutes(basePath = '/ops/audience-navigator') {
  const snapshot = buildAudienceNavigatorSnapshot();
  return [
    { id: 'audience-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceNavigatorReadinessBoard(snapshot) },
    { id: 'audience-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

