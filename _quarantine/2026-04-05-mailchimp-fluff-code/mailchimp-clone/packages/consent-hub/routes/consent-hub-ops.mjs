import { buildConsentHubSnapshot, createConsentHubReadinessBoard } from '../service-consent-hub.mjs';

export function createConsentHubOpsRoutes(basePath = '/ops/consent-hub') {
  const snapshot = buildConsentHubSnapshot();
  return [
    { id: 'consent-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentHubReadinessBoard(snapshot) },
    { id: 'consent-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

