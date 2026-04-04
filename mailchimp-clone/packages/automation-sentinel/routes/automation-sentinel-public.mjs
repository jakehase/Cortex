import { buildAutomationSentinelSnapshot } from '../service-automation-sentinel.mjs';
import { createAutomationSentinelFixtures } from '../fixtures-automation-sentinel.mjs';

export function createAutomationSentinelPublicRoutes(basePath = '/public/automation-sentinel') {
  const snapshot = buildAutomationSentinelSnapshot();
  const fixtures = createAutomationSentinelFixtures();
  return [
    { id: 'automation-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

