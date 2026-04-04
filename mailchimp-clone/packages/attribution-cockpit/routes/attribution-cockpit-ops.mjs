import { buildAttributionCockpitSnapshot, createAttributionCockpitReadinessBoard } from '../service-attribution-cockpit.mjs';

export function createAttributionCockpitOpsRoutes(basePath = '/ops/attribution-cockpit') {
  const snapshot = buildAttributionCockpitSnapshot();
  return [
    { id: 'attribution-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionCockpitReadinessBoard(snapshot) },
    { id: 'attribution-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

