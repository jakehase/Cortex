import { buildLocalizationScorecardSnapshot, createLocalizationScorecardReadinessBoard } from '../service-localization-scorecard.mjs';

export function createLocalizationScorecardOpsRoutes(basePath = '/ops/localization-scorecard') {
  const snapshot = buildLocalizationScorecardSnapshot();
  return [
    { id: 'localization-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationScorecardReadinessBoard(snapshot) },
    { id: 'localization-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

