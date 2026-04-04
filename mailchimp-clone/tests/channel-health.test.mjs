import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelHealthSnapshot, createChannelHealthDashboardRoutes, createChannelHealthApiRoutes, createChannelHealthOpsRoutes, createChannelHealthPublicRoutes, summarizeChannelHealthFixtures } from '../packages/channel-health/index.mjs';

test('channel-health package pushes the continuation over another architecture tier',()=>{const snapshot=buildChannelHealthSnapshot('Final Anchor'); assert.equal(snapshot.summary.workspaceName,'Final Anchor'); assert.equal(snapshot.validation.ok,true); assert.equal(createChannelHealthDashboardRoutes().length,3); assert.equal(createChannelHealthApiRoutes().length,3); assert.equal(createChannelHealthOpsRoutes().length,3); assert.equal(createChannelHealthPublicRoutes().length,3); assert.equal(summarizeChannelHealthFixtures().contacts,2);});
