import { buildAutomationExchangeSnapshot, createAutomationExchangeRouteSummary } from '../service-automation-exchange.mjs';

export function createAutomationExchangeDashboardRoutes(basePath = '/automation-exchange') {
  const snapshot = buildAutomationExchangeSnapshot();
  return [
    { id: 'automation-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationExchangeRouteSummary(snapshot) },
    { id: 'automation-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

