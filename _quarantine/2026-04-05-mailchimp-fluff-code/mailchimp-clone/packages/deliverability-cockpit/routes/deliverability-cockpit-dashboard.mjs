import { buildDeliverabilityCockpitSnapshot, createDeliverabilityCockpitRouteSummary } from '../service-deliverability-cockpit.mjs';

export function createDeliverabilityCockpitDashboardRoutes(basePath = '/deliverability-cockpit') {
  const snapshot = buildDeliverabilityCockpitSnapshot();
  return [
    { id: 'deliverability-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityCockpitRouteSummary(snapshot) },
    { id: 'deliverability-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

