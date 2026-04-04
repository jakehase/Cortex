import { buildAcquisitionVaultSnapshot, createAcquisitionVaultReadinessBoard } from '../service-acquisition-vault.mjs';

export function createAcquisitionVaultOpsRoutes(basePath = '/ops/acquisition-vault') {
  const snapshot = buildAcquisitionVaultSnapshot();
  return [
    { id: 'acquisition-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionVaultReadinessBoard(snapshot) },
    { id: 'acquisition-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

