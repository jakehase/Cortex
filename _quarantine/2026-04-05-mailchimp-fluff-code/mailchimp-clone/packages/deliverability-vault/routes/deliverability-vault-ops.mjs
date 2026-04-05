import { buildDeliverabilityVaultSnapshot, createDeliverabilityVaultReadinessBoard } from '../service-deliverability-vault.mjs';

export function createDeliverabilityVaultOpsRoutes(basePath = '/ops/deliverability-vault') {
  const snapshot = buildDeliverabilityVaultSnapshot();
  return [
    { id: 'deliverability-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityVaultReadinessBoard(snapshot) },
    { id: 'deliverability-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

