import { buildLifecycleCockpitSnapshot, createLifecycleCockpitReadinessBoard } from '../service-lifecycle-cockpit.mjs';

export function createLifecycleCockpitOpsRoutes(basePath = '/ops/lifecycle-cockpit') {
  const snapshot = buildLifecycleCockpitSnapshot();
  return [
    { id: 'lifecycle-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleCockpitReadinessBoard(snapshot) },
    { id: 'lifecycle-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

