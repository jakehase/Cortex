import { buildLocalizationLedgerSnapshot } from '../service-localization-ledger.mjs';
import { createLocalizationLedgerFixtures } from '../fixtures-localization-ledger.mjs';

export function createLocalizationLedgerPublicRoutes(basePath = '/public/localization-ledger') {
  const snapshot = buildLocalizationLedgerSnapshot();
  const fixtures = createLocalizationLedgerFixtures();
  return [
    { id: 'localization-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

