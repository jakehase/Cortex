import { buildCollaborationSentinelSnapshot, createCollaborationSentinelReadinessBoard } from '../service-collaboration-sentinel.mjs';

export function createCollaborationSentinelOpsRoutes(basePath = '/ops/collaboration-sentinel') {
  const snapshot = buildCollaborationSentinelSnapshot();
  return [
    { id: 'collaboration-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationSentinelReadinessBoard(snapshot) },
    { id: 'collaboration-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

