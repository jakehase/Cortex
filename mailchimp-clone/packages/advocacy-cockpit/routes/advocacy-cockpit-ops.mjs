import { buildAdvocacyCockpitSnapshot, createAdvocacyCockpitReadinessBoard } from '../service-advocacy-cockpit.mjs';

export function createAdvocacyCockpitOpsRoutes(basePath = '/ops/advocacy-cockpit') {
  const snapshot = buildAdvocacyCockpitSnapshot();
  return [
    { id: 'advocacy-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyCockpitReadinessBoard(snapshot) },
    { id: 'advocacy-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

