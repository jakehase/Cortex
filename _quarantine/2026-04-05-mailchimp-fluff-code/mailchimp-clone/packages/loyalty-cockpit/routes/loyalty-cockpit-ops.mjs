import { buildLoyaltyCockpitSnapshot, createLoyaltyCockpitReadinessBoard } from '../service-loyalty-cockpit.mjs';

export function createLoyaltyCockpitOpsRoutes(basePath = '/ops/loyalty-cockpit') {
  const snapshot = buildLoyaltyCockpitSnapshot();
  return [
    { id: 'loyalty-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyCockpitReadinessBoard(snapshot) },
    { id: 'loyalty-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

