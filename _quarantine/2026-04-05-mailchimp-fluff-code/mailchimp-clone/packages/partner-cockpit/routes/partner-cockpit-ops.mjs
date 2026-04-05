import { buildPartnerCockpitSnapshot, createPartnerCockpitReadinessBoard } from '../service-partner-cockpit.mjs';

export function createPartnerCockpitOpsRoutes(basePath = '/ops/partner-cockpit') {
  const snapshot = buildPartnerCockpitSnapshot();
  return [
    { id: 'partner-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createPartnerCockpitReadinessBoard(snapshot) },
    { id: 'partner-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'partner-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

