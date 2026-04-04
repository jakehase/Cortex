import { buildLocalizationLedgerSnapshot, createLocalizationLedgerRouteSummary } from '../service-localization-ledger.mjs';

export function createLocalizationLedgerRegistryRoutes(basePath = '/registry/localization-ledger') {
  const snapshot = buildLocalizationLedgerSnapshot();
  return [
    { id: 'localization-ledger.registry.summary', method: 'GET', path: basePath, summary: createLocalizationLedgerRouteSummary(snapshot) },
    { id: 'localization-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

