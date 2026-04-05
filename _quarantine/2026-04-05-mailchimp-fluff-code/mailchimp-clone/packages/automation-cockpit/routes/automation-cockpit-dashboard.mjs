import { buildAutomationCockpitSnapshot, createAutomationCockpitRouteSummary } from '../service-automation-cockpit.mjs';

export function createAutomationCockpitDashboardRoutes(basePath = '/automation-cockpit') {
  const snapshot = buildAutomationCockpitSnapshot();
  return [
    { id: 'automation-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationCockpitRouteSummary(snapshot) },
    { id: 'automation-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

