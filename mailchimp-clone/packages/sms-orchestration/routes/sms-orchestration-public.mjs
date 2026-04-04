import { buildSmsOrchestrationSnapshot } from '../service-sms-orchestration.mjs';
import { createSmsOrchestrationFixtures } from '../fixtures-sms-orchestration.mjs';

export function createSmsOrchestrationPublicRoutes(basePath = '/public/sms-orchestration') {
  const snapshot = buildSmsOrchestrationSnapshot();
  const fixtures = createSmsOrchestrationFixtures();
  return [
    { id: 'sms-orchestration.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'sms-orchestration.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'sms-orchestration.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
