import { buildExperimentationFoundrySnapshot, createExperimentationFoundryReadinessBoard } from '../service-experimentation-foundry.mjs';

export function createExperimentationFoundryOpsRoutes(basePath = '/ops/experimentation-foundry') {
  const snapshot = buildExperimentationFoundrySnapshot();
  return [
    { id: 'experimentation-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationFoundryReadinessBoard(snapshot) },
    { id: 'experimentation-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

