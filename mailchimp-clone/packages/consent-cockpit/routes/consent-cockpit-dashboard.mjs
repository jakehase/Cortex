import { buildConsentCockpitSnapshot, createConsentCockpitRouteSummary } from '../service-consent-cockpit.mjs';

export function createConsentCockpitDashboardRoutes(basePath = '/consent-cockpit') {
  const snapshot = buildConsentCockpitSnapshot();
  return [
    { id: 'consent-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createConsentCockpitRouteSummary(snapshot) },
    { id: 'consent-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

