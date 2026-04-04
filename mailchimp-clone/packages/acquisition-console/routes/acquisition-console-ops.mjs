import { buildAcquisitionConsoleSnapshot, createAcquisitionConsoleReadinessBoard } from '../service-acquisition-console.mjs';

export function createAcquisitionConsoleOpsRoutes(basePath = '/ops/acquisition-console') {
  const snapshot = buildAcquisitionConsoleSnapshot();
  return [
    { id: 'acquisition-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionConsoleReadinessBoard(snapshot) },
    { id: 'acquisition-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

