import { buildExperimentationHubSnapshot, createExperimentationHubReadinessBoard } from '../service-experimentation-hub.mjs';

export function createExperimentationHubOpsRoutes(basePath = '/ops/experimentation-hub') {
  const snapshot = buildExperimentationHubSnapshot();
  return [
    { id: 'experimentation-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationHubReadinessBoard(snapshot) },
    { id: 'experimentation-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

