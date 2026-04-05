import { buildExperimentationCockpitSnapshot, createExperimentationCockpitReadinessBoard } from '../service-experimentation-cockpit.mjs';

export function createExperimentationCockpitOpsRoutes(basePath = '/ops/experimentation-cockpit') {
  const snapshot = buildExperimentationCockpitSnapshot();
  return [
    { id: 'experimentation-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationCockpitReadinessBoard(snapshot) },
    { id: 'experimentation-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

