import { buildDeliverabilityGridSnapshot, createDeliverabilityGridReadinessBoard } from '../service-deliverability-grid.mjs';

export function createDeliverabilityGridOpsRoutes(basePath = '/ops/deliverability-grid') {
  const snapshot = buildDeliverabilityGridSnapshot();
  return [
    { id: 'deliverability-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityGridReadinessBoard(snapshot) },
    { id: 'deliverability-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

