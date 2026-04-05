import { buildDeliverabilityNavigatorSnapshot, createDeliverabilityNavigatorReadinessBoard } from '../service-deliverability-navigator.mjs';

export function createDeliverabilityNavigatorOpsRoutes(basePath = '/ops/deliverability-navigator') {
  const snapshot = buildDeliverabilityNavigatorSnapshot();
  return [
    { id: 'deliverability-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityNavigatorReadinessBoard(snapshot) },
    { id: 'deliverability-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

