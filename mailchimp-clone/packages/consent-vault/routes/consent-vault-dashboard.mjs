import { buildConsentVaultSnapshot, createConsentVaultRouteSummary } from '../service-consent-vault.mjs';

export function createConsentVaultDashboardRoutes(basePath = '/consent-vault') {
  const snapshot = buildConsentVaultSnapshot();
  return [
    { id: 'consent-vault.dashboard.overview', method: 'GET', path: basePath, summary: createConsentVaultRouteSummary(snapshot) },
    { id: 'consent-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

