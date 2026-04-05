import { buildComplianceAtlasSnapshot, createComplianceAtlasRouteSummary } from '../service-compliance-atlas.mjs';

export function createComplianceAtlasDashboardRoutes(basePath = '/compliance-atlas') {
  const snapshot = buildComplianceAtlasSnapshot();
  return [
    { id: 'compliance-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceAtlasRouteSummary(snapshot) },
    { id: 'compliance-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

