import { buildDeliverabilityHubSnapshot, createDeliverabilityHubReadinessBoard } from '../service-deliverability-hub.mjs';

export function createDeliverabilityHubOpsRoutes(basePath = '/ops/deliverability-hub') {
  const snapshot = buildDeliverabilityHubSnapshot();
  return [
    { id: 'deliverability-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityHubReadinessBoard(snapshot) },
    { id: 'deliverability-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

