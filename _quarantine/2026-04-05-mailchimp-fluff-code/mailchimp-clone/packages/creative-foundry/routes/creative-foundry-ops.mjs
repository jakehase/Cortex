import { buildCreativeFoundrySnapshot, createCreativeFoundryReadinessBoard } from '../service-creative-foundry.mjs';

export function createCreativeFoundryOpsRoutes(basePath = '/ops/creative-foundry') {
  const snapshot = buildCreativeFoundrySnapshot();
  return [
    { id: 'creative-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeFoundryReadinessBoard(snapshot) },
    { id: 'creative-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

