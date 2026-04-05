import { buildConsentFoundrySnapshot, createConsentFoundryRouteSummary } from '../service-consent-foundry.mjs';

export function createConsentFoundryDashboardRoutes(basePath = '/consent-foundry') {
  const snapshot = buildConsentFoundrySnapshot();
  return [
    { id: 'consent-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createConsentFoundryRouteSummary(snapshot) },
    { id: 'consent-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

