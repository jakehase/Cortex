import { buildExperimentationScorecardSnapshot, createExperimentationScorecardReadinessBoard } from '../service-experimentation-scorecard.mjs';

export function createExperimentationScorecardOpsRoutes(basePath = '/ops/experimentation-scorecard') {
  const snapshot = buildExperimentationScorecardSnapshot();
  return [
    { id: 'experimentation-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationScorecardReadinessBoard(snapshot) },
    { id: 'experimentation-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

