import { buildAudienceStudioSnapshot, createAudienceStudioReadinessBoard } from '../service-audience-studio.mjs';

export function createAudienceStudioOpsRoutes(basePath = '/ops/audience-studio') {
  const snapshot = buildAudienceStudioSnapshot();
  return [
    { id: 'audience-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceStudioReadinessBoard(snapshot) },
    { id: 'audience-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

