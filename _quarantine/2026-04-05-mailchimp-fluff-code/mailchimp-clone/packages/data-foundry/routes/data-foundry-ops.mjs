import { buildDataFoundrySnapshot, createDataFoundryReadinessBoard } from '../service-data-foundry.mjs';

export function createDataFoundryOpsRoutes(basePath = '/ops/data-foundry') {
  const snapshot = buildDataFoundrySnapshot();
  return [
    { id: 'data-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataFoundryReadinessBoard(snapshot) },
    { id: 'data-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

