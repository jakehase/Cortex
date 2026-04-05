import { buildLocalizationCockpitSnapshot, createLocalizationCockpitReadinessBoard } from '../service-localization-cockpit.mjs';

export function createLocalizationCockpitOpsRoutes(basePath = '/ops/localization-cockpit') {
  const snapshot = buildLocalizationCockpitSnapshot();
  return [
    { id: 'localization-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationCockpitReadinessBoard(snapshot) },
    { id: 'localization-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

