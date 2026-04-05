import { buildAdvocacyNavigatorSnapshot, createAdvocacyNavigatorReadinessBoard } from '../service-advocacy-navigator.mjs';

export function createAdvocacyNavigatorOpsRoutes(basePath = '/ops/advocacy-navigator') {
  const snapshot = buildAdvocacyNavigatorSnapshot();
  return [
    { id: 'advocacy-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyNavigatorReadinessBoard(snapshot) },
    { id: 'advocacy-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

