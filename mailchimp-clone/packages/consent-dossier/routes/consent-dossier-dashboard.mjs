import { buildConsentDossierSnapshot, createConsentDossierRouteSummary } from '../service-consent-dossier.mjs';

export function createConsentDossierDashboardRoutes(basePath = '/consent-dossier') {
  const snapshot = buildConsentDossierSnapshot();
  return [
    { id: 'consent-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createConsentDossierRouteSummary(snapshot) },
    { id: 'consent-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

