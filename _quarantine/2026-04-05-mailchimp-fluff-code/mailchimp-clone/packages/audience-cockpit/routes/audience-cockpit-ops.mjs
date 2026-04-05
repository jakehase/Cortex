import { buildAudienceCockpitSnapshot, createAudienceCockpitReadinessBoard } from '../service-audience-cockpit.mjs';

export function createAudienceCockpitOpsRoutes(basePath = '/ops/audience-cockpit') {
  const snapshot = buildAudienceCockpitSnapshot();
  return [
    { id: 'audience-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceCockpitReadinessBoard(snapshot) },
    { id: 'audience-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

