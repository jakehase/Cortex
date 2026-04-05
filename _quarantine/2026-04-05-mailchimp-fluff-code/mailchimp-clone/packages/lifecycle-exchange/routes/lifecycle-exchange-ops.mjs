import { buildLifecycleExchangeSnapshot, createLifecycleExchangeReadinessBoard } from '../service-lifecycle-exchange.mjs';

export function createLifecycleExchangeOpsRoutes(basePath = '/ops/lifecycle-exchange') {
  const snapshot = buildLifecycleExchangeSnapshot();
  return [
    { id: 'lifecycle-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleExchangeReadinessBoard(snapshot) },
    { id: 'lifecycle-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

