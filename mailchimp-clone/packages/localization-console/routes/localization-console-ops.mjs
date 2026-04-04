import { buildLocalizationConsoleSnapshot, createLocalizationConsoleReadinessBoard } from '../service-localization-console.mjs';

export function createLocalizationConsoleOpsRoutes(basePath = '/ops/localization-console') {
  const snapshot = buildLocalizationConsoleSnapshot();
  return [
    { id: 'localization-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationConsoleReadinessBoard(snapshot) },
    { id: 'localization-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

