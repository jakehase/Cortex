import { buildCreativeCockpitSnapshot, createCreativeCockpitReadinessBoard } from '../service-creative-cockpit.mjs';

export function createCreativeCockpitOpsRoutes(basePath = '/ops/creative-cockpit') {
  const snapshot = buildCreativeCockpitSnapshot();
  return [
    { id: 'creative-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeCockpitReadinessBoard(snapshot) },
    { id: 'creative-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

