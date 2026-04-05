import { buildConsentDossierSnapshot, createConsentDossierReadinessBoard } from '../service-consent-dossier.mjs';

export function createConsentDossierOpsRoutes(basePath = '/ops/consent-dossier') {
  const snapshot = buildConsentDossierSnapshot();
  return [
    { id: 'consent-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentDossierReadinessBoard(snapshot) },
    { id: 'consent-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

