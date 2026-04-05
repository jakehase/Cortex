import { buildLocalizationWorkbenchSnapshot } from '../service-localization-workbench.mjs';
import { createLocalizationWorkbenchFixtures } from '../fixtures-localization-workbench.mjs';

export function createLocalizationWorkbenchPublicRoutes(basePath = '/public/localization-workbench') {
  const snapshot = buildLocalizationWorkbenchSnapshot();
  const fixtures = createLocalizationWorkbenchFixtures();
  return [
    { id: 'localization-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

