import { buildConsentWorkbenchSnapshot } from '../service-consent-workbench.mjs';
import { createConsentWorkbenchFixtures } from '../fixtures-consent-workbench.mjs';

export function createConsentWorkbenchPublicRoutes(basePath = '/public/consent-workbench') {
  const snapshot = buildConsentWorkbenchSnapshot();
  const fixtures = createConsentWorkbenchFixtures();
  return [
    { id: 'consent-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

