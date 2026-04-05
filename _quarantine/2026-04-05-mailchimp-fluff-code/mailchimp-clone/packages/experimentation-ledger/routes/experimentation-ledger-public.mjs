import { buildExperimentationLedgerSnapshot } from '../service-experimentation-ledger.mjs';
import { createExperimentationLedgerFixtures } from '../fixtures-experimentation-ledger.mjs';

export function createExperimentationLedgerPublicRoutes(basePath = '/public/experimentation-ledger') {
  const snapshot = buildExperimentationLedgerSnapshot();
  const fixtures = createExperimentationLedgerFixtures();
  return [
    { id: 'experimentation-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

