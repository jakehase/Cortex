import { buildConsentAdvisorSnapshot, createConsentAdvisorReadinessBoard } from '../service-consent-advisor.mjs';

export function createConsentAdvisorOpsRoutes(basePath = '/ops/consent-advisor') {
  const snapshot = buildConsentAdvisorSnapshot();
  return [
    { id: 'consent-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentAdvisorReadinessBoard(snapshot) },
    { id: 'consent-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

