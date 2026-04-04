import { buildConsentExchangeSnapshot, createConsentExchangeReadinessBoard } from '../service-consent-exchange.mjs';

export function createConsentExchangeOpsRoutes(basePath = '/ops/consent-exchange') {
  const snapshot = buildConsentExchangeSnapshot();
  return [
    { id: 'consent-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentExchangeReadinessBoard(snapshot) },
    { id: 'consent-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

