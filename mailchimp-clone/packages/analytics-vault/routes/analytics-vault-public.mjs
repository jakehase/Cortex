import { buildAnalyticsVaultSnapshot } from '../service-analytics-vault.mjs';
import { createAnalyticsVaultFixtures } from '../fixtures-analytics-vault.mjs';

export function createAnalyticsVaultPublicRoutes(basePath = '/public/analytics-vault') {
  const snapshot = buildAnalyticsVaultSnapshot();
  const fixtures = createAnalyticsVaultFixtures();
  return [
    { id: 'analytics-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

