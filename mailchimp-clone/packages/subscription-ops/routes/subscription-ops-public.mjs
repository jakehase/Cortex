import { buildSubscriptionOpsSnapshot } from '../service-subscription-ops.mjs';
import { createSubscriptionOpsFixtures } from '../fixtures-subscription-ops.mjs';

export function createSubscriptionOpsPublicRoutes(basePath = '/public/subscription-ops') {
  const snapshot = buildSubscriptionOpsSnapshot();
  const fixtures = createSubscriptionOpsFixtures();
  return [
    { id: 'subscription-ops.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'subscription-ops.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'subscription-ops.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
