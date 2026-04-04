import { buildConsentFoundrySnapshot, createConsentFoundryReadinessBoard } from '../service-consent-foundry.mjs';

export function createConsentFoundryOpsRoutes(basePath = '/ops/consent-foundry') {
  const snapshot = buildConsentFoundrySnapshot();
  return [
    { id: 'consent-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentFoundryReadinessBoard(snapshot) },
    { id: 'consent-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

