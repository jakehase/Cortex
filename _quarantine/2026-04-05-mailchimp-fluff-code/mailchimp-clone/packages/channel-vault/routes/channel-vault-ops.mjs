import { buildChannelVaultSnapshot, createChannelVaultReadinessBoard } from '../service-channel-vault.mjs';

export function createChannelVaultOpsRoutes(basePath = '/ops/channel-vault') {
  const snapshot = buildChannelVaultSnapshot();
  return [
    { id: 'channel-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelVaultReadinessBoard(snapshot) },
    { id: 'channel-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

