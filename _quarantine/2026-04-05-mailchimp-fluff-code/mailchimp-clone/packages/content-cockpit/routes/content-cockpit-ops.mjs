import { buildContentCockpitSnapshot, createContentCockpitReadinessBoard } from '../service-content-cockpit.mjs';

export function createContentCockpitOpsRoutes(basePath = '/ops/content-cockpit') {
  const snapshot = buildContentCockpitSnapshot();
  return [
    { id: 'content-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentCockpitReadinessBoard(snapshot) },
    { id: 'content-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

