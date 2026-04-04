import { buildContentFoundrySnapshot, createContentFoundryReadinessBoard } from '../service-content-foundry.mjs';

export function createContentFoundryOpsRoutes(basePath = '/ops/content-foundry') {
  const snapshot = buildContentFoundrySnapshot();
  return [
    { id: 'content-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentFoundryReadinessBoard(snapshot) },
    { id: 'content-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

