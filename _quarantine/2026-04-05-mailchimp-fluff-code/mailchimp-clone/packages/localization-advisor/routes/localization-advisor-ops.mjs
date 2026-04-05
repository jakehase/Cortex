import { buildLocalizationAdvisorSnapshot, createLocalizationAdvisorReadinessBoard } from '../service-localization-advisor.mjs';

export function createLocalizationAdvisorOpsRoutes(basePath = '/ops/localization-advisor') {
  const snapshot = buildLocalizationAdvisorSnapshot();
  return [
    { id: 'localization-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationAdvisorReadinessBoard(snapshot) },
    { id: 'localization-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

