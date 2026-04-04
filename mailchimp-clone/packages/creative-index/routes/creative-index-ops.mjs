import { buildCreativeIndexSnapshot, createCreativeIndexReadinessBoard } from '../service-creative-index.mjs';

export function createCreativeIndexOpsRoutes(basePath = '/ops/creative-index') {
  const snapshot = buildCreativeIndexSnapshot();
  return [
    { id: 'creative-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeIndexReadinessBoard(snapshot) },
    { id: 'creative-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

