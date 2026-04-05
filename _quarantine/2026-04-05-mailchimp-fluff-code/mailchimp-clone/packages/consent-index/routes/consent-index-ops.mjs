import { buildConsentIndexSnapshot, createConsentIndexReadinessBoard } from '../service-consent-index.mjs';

export function createConsentIndexOpsRoutes(basePath = '/ops/consent-index') {
  const snapshot = buildConsentIndexSnapshot();
  return [
    { id: 'consent-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentIndexReadinessBoard(snapshot) },
    { id: 'consent-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

