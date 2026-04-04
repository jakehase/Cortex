import { buildAdvocacyIndexSnapshot, createAdvocacyIndexReadinessBoard } from '../service-advocacy-index.mjs';

export function createAdvocacyIndexOpsRoutes(basePath = '/ops/advocacy-index') {
  const snapshot = buildAdvocacyIndexSnapshot();
  return [
    { id: 'advocacy-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyIndexReadinessBoard(snapshot) },
    { id: 'advocacy-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

