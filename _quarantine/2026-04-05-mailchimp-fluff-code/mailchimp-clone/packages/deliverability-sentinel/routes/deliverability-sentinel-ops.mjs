import { buildDeliverabilitySentinelSnapshot, createDeliverabilitySentinelReadinessBoard } from '../service-deliverability-sentinel.mjs';

export function createDeliverabilitySentinelOpsRoutes(basePath = '/ops/deliverability-sentinel') {
  const snapshot = buildDeliverabilitySentinelSnapshot();
  return [
    { id: 'deliverability-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilitySentinelReadinessBoard(snapshot) },
    { id: 'deliverability-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

