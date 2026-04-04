import { buildDeliverabilityIndexSnapshot, createDeliverabilityIndexReadinessBoard } from '../service-deliverability-index.mjs';

export function createDeliverabilityIndexOpsRoutes(basePath = '/ops/deliverability-index') {
  const snapshot = buildDeliverabilityIndexSnapshot();
  return [
    { id: 'deliverability-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityIndexReadinessBoard(snapshot) },
    { id: 'deliverability-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

