import { buildAudienceFoundrySnapshot, createAudienceFoundryReadinessBoard } from '../service-audience-foundry.mjs';

export function createAudienceFoundryOpsRoutes(basePath = '/ops/audience-foundry') {
  const snapshot = buildAudienceFoundrySnapshot();
  return [
    { id: 'audience-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceFoundryReadinessBoard(snapshot) },
    { id: 'audience-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

