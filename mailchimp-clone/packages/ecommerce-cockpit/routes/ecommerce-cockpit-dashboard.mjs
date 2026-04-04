import { buildEcommerceCockpitSnapshot, createEcommerceCockpitRouteSummary } from '../service-ecommerce-cockpit.mjs';

export function createEcommerceCockpitDashboardRoutes(basePath = '/ecommerce-cockpit') {
  const snapshot = buildEcommerceCockpitSnapshot();
  return [
    { id: 'ecommerce-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceCockpitRouteSummary(snapshot) },
    { id: 'ecommerce-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

