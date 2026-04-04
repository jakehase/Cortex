import { buildBrandGovernanceSnapshot } from '../service-brand-governance.mjs';

export function createBrandGovernanceDashboardRoutes(basePath = '/brand-governance') {
  const snapshot = buildBrandGovernanceSnapshot();
  return [
    { id: 'brand-governance.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'brand-governance.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'brand-governance.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
