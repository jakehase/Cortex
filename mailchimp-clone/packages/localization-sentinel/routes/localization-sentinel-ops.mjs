import { buildLocalizationSentinelSnapshot, createLocalizationSentinelReadinessBoard } from '../service-localization-sentinel.mjs';

export function createLocalizationSentinelOpsRoutes(basePath = '/ops/localization-sentinel') {
  const snapshot = buildLocalizationSentinelSnapshot();
  return [
    { id: 'localization-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationSentinelReadinessBoard(snapshot) },
    { id: 'localization-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

