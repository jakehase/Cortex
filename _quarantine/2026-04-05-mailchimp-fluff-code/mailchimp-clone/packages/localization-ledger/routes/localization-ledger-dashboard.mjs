import { buildLocalizationLedgerSnapshot, createLocalizationLedgerRouteSummary } from '../service-localization-ledger.mjs';

export function createLocalizationLedgerDashboardRoutes(basePath = '/localization-ledger') {
  const snapshot = buildLocalizationLedgerSnapshot();
  return [
    { id: 'localization-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationLedgerRouteSummary(snapshot) },
    { id: 'localization-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

