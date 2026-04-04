import { buildExperimentationVaultSnapshot } from '../service-experimentation-vault.mjs';
import { createExperimentationVaultFixtures } from '../fixtures-experimentation-vault.mjs';

export function createExperimentationVaultPublicRoutes(basePath = '/public/experimentation-vault') {
  const snapshot = buildExperimentationVaultSnapshot();
  const fixtures = createExperimentationVaultFixtures();
  return [
    { id: 'experimentation-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

