import { buildActivationCockpitSnapshot, createActivationCockpitRouteSummary } from '../service-activation-cockpit.mjs';

export function createActivationCockpitDashboardRoutes(basePath = '/activation-cockpit') {
  const snapshot = buildActivationCockpitSnapshot();
  return [
    { id: 'activation-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createActivationCockpitRouteSummary(snapshot) },
    { id: 'activation-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

