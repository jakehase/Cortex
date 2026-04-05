import { buildDataHubSnapshot, createDataHubReadinessBoard } from '../service-data-hub.mjs';

export function createDataHubOpsRoutes(basePath = '/ops/data-hub') {
  const snapshot = buildDataHubSnapshot();
  return [
    { id: 'data-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataHubReadinessBoard(snapshot) },
    { id: 'data-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

