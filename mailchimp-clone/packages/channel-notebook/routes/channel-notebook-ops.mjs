import { buildChannelNotebookSnapshot, createChannelNotebookReadinessBoard } from '../service-channel-notebook.mjs';

export function createChannelNotebookOpsRoutes(basePath = '/ops/channel-notebook') {
  const snapshot = buildChannelNotebookSnapshot();
  return [
    { id: 'channel-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelNotebookReadinessBoard(snapshot) },
    { id: 'channel-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

