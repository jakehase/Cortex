import { buildAdvocacyStudioSnapshot, createAdvocacyStudioReadinessBoard } from '../service-advocacy-studio.mjs';

export function createAdvocacyStudioOpsRoutes(basePath = '/ops/advocacy-studio') {
  const snapshot = buildAdvocacyStudioSnapshot();
  return [
    { id: 'advocacy-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyStudioReadinessBoard(snapshot) },
    { id: 'advocacy-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

