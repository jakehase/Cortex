import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceLabNotebooksSnapshot, createAudienceLabNotebooksDashboardRoutes, createAudienceLabNotebooksApiRoutes, createAudienceLabNotebooksOpsRoutes, createAudienceLabNotebooksPublicRoutes, summarizeAudienceLabNotebooksFixtures } from '../packages/audience-lab-notebooks/index.mjs';

test('audience-lab-notebooks package adds another closeout architecture slice',()=>{const snapshot=buildAudienceLabNotebooksSnapshot('Closeout Anchor'); assert.equal(snapshot.summary.workspaceName,'Closeout Anchor'); assert.equal(snapshot.validation.ok,true); assert.equal(createAudienceLabNotebooksDashboardRoutes().length,3); assert.equal(createAudienceLabNotebooksApiRoutes().length,3); assert.equal(createAudienceLabNotebooksOpsRoutes().length,3); assert.equal(createAudienceLabNotebooksPublicRoutes().length,3); assert.equal(summarizeAudienceLabNotebooksFixtures().contacts,2);});
