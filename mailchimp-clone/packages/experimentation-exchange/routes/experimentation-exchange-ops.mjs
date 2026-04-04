import { buildExperimentationExchangeSnapshot, createExperimentationExchangeReadinessBoard } from '../service-experimentation-exchange.mjs';

export function createExperimentationExchangeOpsRoutes(basePath = '/ops/experimentation-exchange') {
  const snapshot = buildExperimentationExchangeSnapshot();
  return [
    { id: 'experimentation-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationExchangeReadinessBoard(snapshot) },
    { id: 'experimentation-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

