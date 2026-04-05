import { buildPartnerCockpitSnapshot, createPartnerCockpitRouteSummary } from '../service-partner-cockpit.mjs';

export function createPartnerCockpitDashboardRoutes(basePath = '/partner-cockpit') {
  const snapshot = buildPartnerCockpitSnapshot();
  return [
    { id: 'partner-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createPartnerCockpitRouteSummary(snapshot) },
    { id: 'partner-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'partner-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

