import { buildLifecycleVaultSnapshot, createLifecycleVaultReadinessBoard } from '../service-lifecycle-vault.mjs';

export function createLifecycleVaultOpsRoutes(basePath = '/ops/lifecycle-vault') {
  const snapshot = buildLifecycleVaultSnapshot();
  return [
    { id: 'lifecycle-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleVaultReadinessBoard(snapshot) },
    { id: 'lifecycle-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

