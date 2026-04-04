import { buildAcquisitionHubSnapshot, createAcquisitionHubReadinessBoard } from '../service-acquisition-hub.mjs';

export function createAcquisitionHubOpsRoutes(basePath = '/ops/acquisition-hub') {
  const snapshot = buildAcquisitionHubSnapshot();
  return [
    { id: 'acquisition-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionHubReadinessBoard(snapshot) },
    { id: 'acquisition-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

