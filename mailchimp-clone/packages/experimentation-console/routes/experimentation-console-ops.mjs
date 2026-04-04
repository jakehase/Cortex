import { buildExperimentationConsoleSnapshot, createExperimentationConsoleReadinessBoard } from '../service-experimentation-console.mjs';

export function createExperimentationConsoleOpsRoutes(basePath = '/ops/experimentation-console') {
  const snapshot = buildExperimentationConsoleSnapshot();
  return [
    { id: 'experimentation-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationConsoleReadinessBoard(snapshot) },
    { id: 'experimentation-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

