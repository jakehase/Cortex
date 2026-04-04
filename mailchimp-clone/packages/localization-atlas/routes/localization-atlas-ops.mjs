import { buildLocalizationAtlasSnapshot, createLocalizationAtlasReadinessBoard } from '../service-localization-atlas.mjs';

export function createLocalizationAtlasOpsRoutes(basePath = '/ops/localization-atlas') {
  const snapshot = buildLocalizationAtlasSnapshot();
  return [
    { id: 'localization-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationAtlasReadinessBoard(snapshot) },
    { id: 'localization-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

