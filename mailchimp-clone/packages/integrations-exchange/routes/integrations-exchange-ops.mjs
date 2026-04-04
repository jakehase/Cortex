import { buildIntegrationsExchangeSnapshot, createIntegrationsExchangeReadinessBoard } from '../service-integrations-exchange.mjs';

export function createIntegrationsExchangeOpsRoutes(basePath = '/ops/integrations-exchange') {
  const snapshot = buildIntegrationsExchangeSnapshot();
  return [
    { id: 'integrations-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsExchangeReadinessBoard(snapshot) },
    { id: 'integrations-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

