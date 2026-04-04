import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceFunnelsSnapshot, createAudienceFunnelsDashboardRoutes, createAudienceFunnelsApiRoutes, createAudienceFunnelsOpsRoutes, createAudienceFunnelsPublicRoutes, summarizeAudienceFunnelsFixtures } from '../packages/audience-funnels/index.mjs';

test('audience-funnels package pushes the continuation over another architecture tier',()=>{const snapshot=buildAudienceFunnelsSnapshot('Final Anchor'); assert.equal(snapshot.summary.workspaceName,'Final Anchor'); assert.equal(snapshot.validation.ok,true); assert.equal(createAudienceFunnelsDashboardRoutes().length,3); assert.equal(createAudienceFunnelsApiRoutes().length,3); assert.equal(createAudienceFunnelsOpsRoutes().length,3); assert.equal(createAudienceFunnelsPublicRoutes().length,3); assert.equal(summarizeAudienceFunnelsFixtures().contacts,2);});
