import { buildActivationAtlasSnapshot, createActivationAtlasReadinessBoard } from '../service-activation-atlas.mjs';

export function createActivationAtlasOpsRoutes(basePath = '/ops/activation-atlas') {
  const snapshot = buildActivationAtlasSnapshot();
  return [
    { id: 'activation-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationAtlasReadinessBoard(snapshot) },
    { id: 'activation-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

