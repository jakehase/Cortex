import { buildCommerceCockpitSnapshot, createCommerceCockpitReadinessBoard } from '../service-commerce-cockpit.mjs';

export function createCommerceCockpitOpsRoutes(basePath = '/ops/commerce-cockpit') {
  const snapshot = buildCommerceCockpitSnapshot();
  return [
    { id: 'commerce-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceCockpitReadinessBoard(snapshot) },
    { id: 'commerce-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

