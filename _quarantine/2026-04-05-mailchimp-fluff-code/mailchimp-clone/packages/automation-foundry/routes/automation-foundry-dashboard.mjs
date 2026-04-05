import { buildAutomationFoundrySnapshot, createAutomationFoundryRouteSummary } from '../service-automation-foundry.mjs';

export function createAutomationFoundryDashboardRoutes(basePath = '/automation-foundry') {
  const snapshot = buildAutomationFoundrySnapshot();
  return [
    { id: 'automation-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationFoundryRouteSummary(snapshot) },
    { id: 'automation-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

