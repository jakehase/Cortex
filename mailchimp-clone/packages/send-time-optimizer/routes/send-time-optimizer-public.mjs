import { buildSendTimeOptimizerSnapshot } from '../service-send-time-optimizer.mjs';
import { createSendTimeOptimizerFixtures } from '../fixtures-send-time-optimizer.mjs';

export function createSendTimeOptimizerPublicRoutes(basePath = '/public/send-time-optimizer') {
  const snapshot = buildSendTimeOptimizerSnapshot();
  const fixtures = createSendTimeOptimizerFixtures();
  return [
    { id: 'send-time-optimizer.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'send-time-optimizer.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'send-time-optimizer.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
