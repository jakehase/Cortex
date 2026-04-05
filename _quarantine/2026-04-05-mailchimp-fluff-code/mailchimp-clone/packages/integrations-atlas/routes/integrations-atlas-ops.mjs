import { buildIntegrationsAtlasSnapshot, createIntegrationsAtlasReadinessBoard } from '../service-integrations-atlas.mjs';

export function createIntegrationsAtlasOpsRoutes(basePath = '/ops/integrations-atlas') {
  const snapshot = buildIntegrationsAtlasSnapshot();
  return [
    { id: 'integrations-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsAtlasReadinessBoard(snapshot) },
    { id: 'integrations-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

