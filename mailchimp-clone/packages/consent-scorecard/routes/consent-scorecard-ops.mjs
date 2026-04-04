import { buildConsentScorecardSnapshot, createConsentScorecardReadinessBoard } from '../service-consent-scorecard.mjs';

export function createConsentScorecardOpsRoutes(basePath = '/ops/consent-scorecard') {
  const snapshot = buildConsentScorecardSnapshot();
  return [
    { id: 'consent-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentScorecardReadinessBoard(snapshot) },
    { id: 'consent-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

