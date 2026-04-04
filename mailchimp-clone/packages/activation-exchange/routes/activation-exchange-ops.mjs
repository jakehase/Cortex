import { buildActivationExchangeSnapshot, createActivationExchangeReadinessBoard } from '../service-activation-exchange.mjs';

export function createActivationExchangeOpsRoutes(basePath = '/ops/activation-exchange') {
  const snapshot = buildActivationExchangeSnapshot();
  return [
    { id: 'activation-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationExchangeReadinessBoard(snapshot) },
    { id: 'activation-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

