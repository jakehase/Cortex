import { buildAcquisitionWatchtowerSnapshot, createAcquisitionWatchtowerReadinessBoard } from '../service-acquisition-watchtower.mjs';

export function createAcquisitionWatchtowerOpsRoutes(basePath = '/ops/acquisition-watchtower') {
  const snapshot = buildAcquisitionWatchtowerSnapshot();
  return [
    { id: 'acquisition-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionWatchtowerReadinessBoard(snapshot) },
    { id: 'acquisition-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

