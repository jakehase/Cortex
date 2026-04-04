import { buildAcquisitionCockpitSnapshot, createAcquisitionCockpitReadinessBoard } from '../service-acquisition-cockpit.mjs';

export function createAcquisitionCockpitOpsRoutes(basePath = '/ops/acquisition-cockpit') {
  const snapshot = buildAcquisitionCockpitSnapshot();
  return [
    { id: 'acquisition-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionCockpitReadinessBoard(snapshot) },
    { id: 'acquisition-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

