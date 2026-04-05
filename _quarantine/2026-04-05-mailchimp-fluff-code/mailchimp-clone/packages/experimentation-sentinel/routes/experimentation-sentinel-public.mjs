import { buildExperimentationSentinelSnapshot } from '../service-experimentation-sentinel.mjs';
import { createExperimentationSentinelFixtures } from '../fixtures-experimentation-sentinel.mjs';

export function createExperimentationSentinelPublicRoutes(basePath = '/public/experimentation-sentinel') {
  const snapshot = buildExperimentationSentinelSnapshot();
  const fixtures = createExperimentationSentinelFixtures();
  return [
    { id: 'experimentation-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

