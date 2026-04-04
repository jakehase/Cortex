import { buildInsightsVaultSnapshot } from '../service-insights-vault.mjs';
import { createInsightsVaultFixtures } from '../fixtures-insights-vault.mjs';

export function createInsightsVaultPublicRoutes(basePath = '/public/insights-vault') {
  const snapshot = buildInsightsVaultSnapshot();
  const fixtures = createInsightsVaultFixtures();
  return [
    { id: 'insights-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

