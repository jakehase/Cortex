import { buildConsentSentinelSnapshot } from '../service-consent-sentinel.mjs';
import { createConsentSentinelFixtures } from '../fixtures-consent-sentinel.mjs';

export function createConsentSentinelPublicRoutes(basePath = '/public/consent-sentinel') {
  const snapshot = buildConsentSentinelSnapshot();
  const fixtures = createConsentSentinelFixtures();
  return [
    { id: 'consent-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

