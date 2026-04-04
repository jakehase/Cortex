import { buildAcquisitionFoundrySnapshot, createAcquisitionFoundryReadinessBoard } from '../service-acquisition-foundry.mjs';

export function createAcquisitionFoundryOpsRoutes(basePath = '/ops/acquisition-foundry') {
  const snapshot = buildAcquisitionFoundrySnapshot();
  return [
    { id: 'acquisition-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionFoundryReadinessBoard(snapshot) },
    { id: 'acquisition-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

