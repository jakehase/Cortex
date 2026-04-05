import { buildConsentWorkbenchSnapshot, createConsentWorkbenchRouteSummary } from '../service-consent-workbench.mjs';

export function createConsentWorkbenchDashboardRoutes(basePath = '/consent-workbench') {
  const snapshot = buildConsentWorkbenchSnapshot();
  return [
    { id: 'consent-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createConsentWorkbenchRouteSummary(snapshot) },
    { id: 'consent-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

