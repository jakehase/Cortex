import { buildDeliverabilitySentinelSnapshot } from '../service-deliverability-sentinel.mjs';
import { createDeliverabilitySentinelFixtures } from '../fixtures-deliverability-sentinel.mjs';

export function createDeliverabilitySentinelPublicRoutes(basePath = '/public/deliverability-sentinel') {
  const snapshot = buildDeliverabilitySentinelSnapshot();
  const fixtures = createDeliverabilitySentinelFixtures();
  return [
    { id: 'deliverability-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

