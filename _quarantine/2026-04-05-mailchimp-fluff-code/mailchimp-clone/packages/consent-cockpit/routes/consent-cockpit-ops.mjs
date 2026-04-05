import { buildConsentCockpitSnapshot, createConsentCockpitReadinessBoard } from '../service-consent-cockpit.mjs';

export function createConsentCockpitOpsRoutes(basePath = '/ops/consent-cockpit') {
  const snapshot = buildConsentCockpitSnapshot();
  return [
    { id: 'consent-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentCockpitReadinessBoard(snapshot) },
    { id: 'consent-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

