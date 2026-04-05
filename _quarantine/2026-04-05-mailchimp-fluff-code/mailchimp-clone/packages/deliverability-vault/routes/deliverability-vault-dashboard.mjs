import { buildDeliverabilityVaultSnapshot, createDeliverabilityVaultRouteSummary } from '../service-deliverability-vault.mjs';

export function createDeliverabilityVaultDashboardRoutes(basePath = '/deliverability-vault') {
  const snapshot = buildDeliverabilityVaultSnapshot();
  return [
    { id: 'deliverability-vault.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityVaultRouteSummary(snapshot) },
    { id: 'deliverability-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

