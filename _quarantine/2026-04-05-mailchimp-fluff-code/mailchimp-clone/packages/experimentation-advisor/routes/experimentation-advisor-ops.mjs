import { buildExperimentationAdvisorSnapshot, createExperimentationAdvisorReadinessBoard } from '../service-experimentation-advisor.mjs';

export function createExperimentationAdvisorOpsRoutes(basePath = '/ops/experimentation-advisor') {
  const snapshot = buildExperimentationAdvisorSnapshot();
  return [
    { id: 'experimentation-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationAdvisorReadinessBoard(snapshot) },
    { id: 'experimentation-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

