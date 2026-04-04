import { buildContentSentinelSnapshot, createContentSentinelReadinessBoard } from '../service-content-sentinel.mjs';

export function createContentSentinelOpsRoutes(basePath = '/ops/content-sentinel') {
  const snapshot = buildContentSentinelSnapshot();
  return [
    { id: 'content-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentSentinelReadinessBoard(snapshot) },
    { id: 'content-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

