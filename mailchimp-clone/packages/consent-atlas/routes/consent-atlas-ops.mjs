import { buildConsentAtlasSnapshot, createConsentAtlasReadinessBoard } from '../service-consent-atlas.mjs';

export function createConsentAtlasOpsRoutes(basePath = '/ops/consent-atlas') {
  const snapshot = buildConsentAtlasSnapshot();
  return [
    { id: 'consent-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentAtlasReadinessBoard(snapshot) },
    { id: 'consent-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

