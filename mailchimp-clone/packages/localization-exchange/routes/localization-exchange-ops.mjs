import { buildLocalizationExchangeSnapshot, createLocalizationExchangeReadinessBoard } from '../service-localization-exchange.mjs';

export function createLocalizationExchangeOpsRoutes(basePath = '/ops/localization-exchange') {
  const snapshot = buildLocalizationExchangeSnapshot();
  return [
    { id: 'localization-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationExchangeReadinessBoard(snapshot) },
    { id: 'localization-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

