import { buildLocalizationHubSnapshot, createLocalizationHubReadinessBoard } from '../service-localization-hub.mjs';

export function createLocalizationHubOpsRoutes(basePath = '/ops/localization-hub') {
  const snapshot = buildLocalizationHubSnapshot();
  return [
    { id: 'localization-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationHubReadinessBoard(snapshot) },
    { id: 'localization-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

