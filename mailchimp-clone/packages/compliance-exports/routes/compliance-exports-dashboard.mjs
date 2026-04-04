import { buildComplianceExportsSnapshot } from '../service-compliance-exports.mjs';

export function createComplianceExportsDashboardRoutes(basePath = '/compliance-exports') {
  const snapshot = buildComplianceExportsSnapshot();
  return [
    { id: 'compliance-exports.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'compliance-exports.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-exports.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
