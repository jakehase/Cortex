import { buildDeliverabilityStudioSnapshot, createDeliverabilityStudioReadinessBoard } from '../service-deliverability-studio.mjs';

export function createDeliverabilityStudioOpsRoutes(basePath = '/ops/deliverability-studio') {
  const snapshot = buildDeliverabilityStudioSnapshot();
  return [
    { id: 'deliverability-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityStudioReadinessBoard(snapshot) },
    { id: 'deliverability-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

