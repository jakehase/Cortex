import { buildLocalizationFoundrySnapshot, createLocalizationFoundryReadinessBoard } from '../service-localization-foundry.mjs';

export function createLocalizationFoundryOpsRoutes(basePath = '/ops/localization-foundry') {
  const snapshot = buildLocalizationFoundrySnapshot();
  return [
    { id: 'localization-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationFoundryReadinessBoard(snapshot) },
    { id: 'localization-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

