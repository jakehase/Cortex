import { buildChannelWorkbenchSnapshot, createChannelWorkbenchReadinessBoard } from '../service-channel-workbench.mjs';

export function createChannelWorkbenchOpsRoutes(basePath = '/ops/channel-workbench') {
  const snapshot = buildChannelWorkbenchSnapshot();
  return [
    { id: 'channel-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelWorkbenchReadinessBoard(snapshot) },
    { id: 'channel-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

