import { buildConsentNavigatorSnapshot, createConsentNavigatorReadinessBoard } from '../service-consent-navigator.mjs';

export function createConsentNavigatorOpsRoutes(basePath = '/ops/consent-navigator') {
  const snapshot = buildConsentNavigatorSnapshot();
  return [
    { id: 'consent-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentNavigatorReadinessBoard(snapshot) },
    { id: 'consent-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

