import { buildAcquisitionWorkbenchSnapshot, createAcquisitionWorkbenchReadinessBoard } from '../service-acquisition-workbench.mjs';

export function createAcquisitionWorkbenchOpsRoutes(basePath = '/ops/acquisition-workbench') {
  const snapshot = buildAcquisitionWorkbenchSnapshot();
  return [
    { id: 'acquisition-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionWorkbenchReadinessBoard(snapshot) },
    { id: 'acquisition-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

