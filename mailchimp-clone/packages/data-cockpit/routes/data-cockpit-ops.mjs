import { buildDataCockpitSnapshot, createDataCockpitReadinessBoard } from '../service-data-cockpit.mjs';

export function createDataCockpitOpsRoutes(basePath = '/ops/data-cockpit') {
  const snapshot = buildDataCockpitSnapshot();
  return [
    { id: 'data-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataCockpitReadinessBoard(snapshot) },
    { id: 'data-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

