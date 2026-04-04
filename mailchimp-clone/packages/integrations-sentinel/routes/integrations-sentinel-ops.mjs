import { buildIntegrationsSentinelSnapshot, createIntegrationsSentinelReadinessBoard } from '../service-integrations-sentinel.mjs';

export function createIntegrationsSentinelOpsRoutes(basePath = '/ops/integrations-sentinel') {
  const snapshot = buildIntegrationsSentinelSnapshot();
  return [
    { id: 'integrations-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsSentinelReadinessBoard(snapshot) },
    { id: 'integrations-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

