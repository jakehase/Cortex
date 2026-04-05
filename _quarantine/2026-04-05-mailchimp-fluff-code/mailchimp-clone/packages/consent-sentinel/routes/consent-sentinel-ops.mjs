import { buildConsentSentinelSnapshot, createConsentSentinelReadinessBoard } from '../service-consent-sentinel.mjs';

export function createConsentSentinelOpsRoutes(basePath = '/ops/consent-sentinel') {
  const snapshot = buildConsentSentinelSnapshot();
  return [
    { id: 'consent-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentSentinelReadinessBoard(snapshot) },
    { id: 'consent-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

