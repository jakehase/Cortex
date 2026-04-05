import { buildCreativeStudioSnapshot, createCreativeStudioReadinessBoard } from '../service-creative-studio.mjs';

export function createCreativeStudioOpsRoutes(basePath = '/ops/creative-studio') {
  const snapshot = buildCreativeStudioSnapshot();
  return [
    { id: 'creative-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeStudioReadinessBoard(snapshot) },
    { id: 'creative-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

