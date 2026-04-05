import { buildExperimentationSentinelSnapshot, createExperimentationSentinelReadinessBoard } from '../service-experimentation-sentinel.mjs';

export function createExperimentationSentinelOpsRoutes(basePath = '/ops/experimentation-sentinel') {
  const snapshot = buildExperimentationSentinelSnapshot();
  return [
    { id: 'experimentation-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationSentinelReadinessBoard(snapshot) },
    { id: 'experimentation-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

