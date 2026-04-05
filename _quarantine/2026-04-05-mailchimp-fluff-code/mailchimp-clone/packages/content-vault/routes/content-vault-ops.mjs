import { buildContentVaultSnapshot, createContentVaultReadinessBoard } from '../service-content-vault.mjs';

export function createContentVaultOpsRoutes(basePath = '/ops/content-vault') {
  const snapshot = buildContentVaultSnapshot();
  return [
    { id: 'content-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentVaultReadinessBoard(snapshot) },
    { id: 'content-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

