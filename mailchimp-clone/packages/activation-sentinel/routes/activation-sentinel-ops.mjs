import { buildActivationSentinelSnapshot, createActivationSentinelReadinessBoard } from '../service-activation-sentinel.mjs';

export function createActivationSentinelOpsRoutes(basePath = '/ops/activation-sentinel') {
  const snapshot = buildActivationSentinelSnapshot();
  return [
    { id: 'activation-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationSentinelReadinessBoard(snapshot) },
    { id: 'activation-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

