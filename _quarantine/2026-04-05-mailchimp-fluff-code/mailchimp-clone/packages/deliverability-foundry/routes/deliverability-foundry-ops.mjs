import { buildDeliverabilityFoundrySnapshot, createDeliverabilityFoundryReadinessBoard } from '../service-deliverability-foundry.mjs';

export function createDeliverabilityFoundryOpsRoutes(basePath = '/ops/deliverability-foundry') {
  const snapshot = buildDeliverabilityFoundrySnapshot();
  return [
    { id: 'deliverability-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityFoundryReadinessBoard(snapshot) },
    { id: 'deliverability-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

