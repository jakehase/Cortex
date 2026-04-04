import { buildAcquisitionExchangeSnapshot, createAcquisitionExchangeReadinessBoard } from '../service-acquisition-exchange.mjs';

export function createAcquisitionExchangeOpsRoutes(basePath = '/ops/acquisition-exchange') {
  const snapshot = buildAcquisitionExchangeSnapshot();
  return [
    { id: 'acquisition-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionExchangeReadinessBoard(snapshot) },
    { id: 'acquisition-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

