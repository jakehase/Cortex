import { buildAudienceHubSnapshot, createAudienceHubReadinessBoard } from '../service-audience-hub.mjs';

export function createAudienceHubOpsRoutes(basePath = '/ops/audience-hub') {
  const snapshot = buildAudienceHubSnapshot();
  return [
    { id: 'audience-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceHubReadinessBoard(snapshot) },
    { id: 'audience-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

