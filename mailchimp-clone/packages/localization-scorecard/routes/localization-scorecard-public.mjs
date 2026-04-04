import { buildLocalizationScorecardSnapshot } from '../service-localization-scorecard.mjs';
import { createLocalizationScorecardFixtures } from '../fixtures-localization-scorecard.mjs';

export function createLocalizationScorecardPublicRoutes(basePath = '/public/localization-scorecard') {
  const snapshot = buildLocalizationScorecardSnapshot();
  const fixtures = createLocalizationScorecardFixtures();
  return [
    { id: 'localization-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

