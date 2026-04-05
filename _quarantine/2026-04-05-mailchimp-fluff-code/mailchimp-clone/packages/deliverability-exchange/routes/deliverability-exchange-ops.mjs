import { buildDeliverabilityExchangeSnapshot, createDeliverabilityExchangeReadinessBoard } from '../service-deliverability-exchange.mjs';

export function createDeliverabilityExchangeOpsRoutes(basePath = '/ops/deliverability-exchange') {
  const snapshot = buildDeliverabilityExchangeSnapshot();
  return [
    { id: 'deliverability-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityExchangeReadinessBoard(snapshot) },
    { id: 'deliverability-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

