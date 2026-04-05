import { buildExperimentationAtlasSnapshot, createExperimentationAtlasReadinessBoard } from '../service-experimentation-atlas.mjs';

export function createExperimentationAtlasOpsRoutes(basePath = '/ops/experimentation-atlas') {
  const snapshot = buildExperimentationAtlasSnapshot();
  return [
    { id: 'experimentation-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationAtlasReadinessBoard(snapshot) },
    { id: 'experimentation-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

