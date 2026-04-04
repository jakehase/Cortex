import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignCalendarSnapshot, createCampaignCalendarDashboardRoutes, createCampaignCalendarApiRoutes, createCampaignCalendarOpsRoutes, createCampaignCalendarPublicRoutes, summarizeCampaignCalendarFixtures } from '../packages/campaign-calendar/index.mjs';

test('campaign-calendar package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildCampaignCalendarSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignCalendarDashboardRoutes().length, 3);
  assert.equal(createCampaignCalendarApiRoutes().length, 3);
  assert.equal(createCampaignCalendarOpsRoutes().length, 3);
  assert.equal(createCampaignCalendarPublicRoutes().length, 3);
  assert.equal(summarizeCampaignCalendarFixtures().contacts, 2);
});
