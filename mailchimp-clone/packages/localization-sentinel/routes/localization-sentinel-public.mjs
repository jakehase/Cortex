import { buildLocalizationSentinelSnapshot } from '../service-localization-sentinel.mjs';
import { createLocalizationSentinelFixtures } from '../fixtures-localization-sentinel.mjs';

export function createLocalizationSentinelPublicRoutes(basePath = '/public/localization-sentinel') {
  const snapshot = buildLocalizationSentinelSnapshot();
  const fixtures = createLocalizationSentinelFixtures();
  return [
    { id: 'localization-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

