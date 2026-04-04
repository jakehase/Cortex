import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignOpsSnapshot, createCampaignOpsDashboardRoutes, createCampaignOpsApiRoutes, createCampaignOpsOpsRoutes, createCampaignOpsPublicRoutes, summarizeCampaignOpsFixtures } from '../packages/campaign-ops/index.mjs';

test('campaign-ops package pushes the continuation over another architecture tier',()=>{const snapshot=buildCampaignOpsSnapshot('Final Anchor'); assert.equal(snapshot.summary.workspaceName,'Final Anchor'); assert.equal(snapshot.validation.ok,true); assert.equal(createCampaignOpsDashboardRoutes().length,3); assert.equal(createCampaignOpsApiRoutes().length,3); assert.equal(createCampaignOpsOpsRoutes().length,3); assert.equal(createCampaignOpsPublicRoutes().length,3); assert.equal(summarizeCampaignOpsFixtures().contacts,2);});
