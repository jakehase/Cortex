import { buildAcquisitionCockpitSnapshot, createAcquisitionCockpitRouteSummary } from '../service-acquisition-cockpit.mjs';

export function createAcquisitionCockpitDashboardRoutes(basePath = '/acquisition-cockpit') {
  const snapshot = buildAcquisitionCockpitSnapshot();
  return [
    { id: 'acquisition-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionCockpitRouteSummary(snapshot) },
    { id: 'acquisition-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

