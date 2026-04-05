import { buildComplianceCockpitSnapshot, createComplianceCockpitRouteSummary } from '../service-compliance-cockpit.mjs';

export function createComplianceCockpitDashboardRoutes(basePath = '/compliance-cockpit') {
  const snapshot = buildComplianceCockpitSnapshot();
  return [
    { id: 'compliance-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceCockpitRouteSummary(snapshot) },
    { id: 'compliance-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

