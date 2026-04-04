import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJourneyAnnotationsSnapshot, createJourneyAnnotationsDashboardRoutes, createJourneyAnnotationsApiRoutes, createJourneyAnnotationsOpsRoutes, createJourneyAnnotationsPublicRoutes, summarizeJourneyAnnotationsFixtures } from '../packages/journey-annotations/index.mjs';

test('journey-annotations package adds one more late-closeout architecture slice',()=>{const snapshot=buildJourneyAnnotationsSnapshot('Late Closeout'); assert.equal(snapshot.summary.workspaceName,'Late Closeout'); assert.equal(snapshot.validation.ok,true); assert.equal(createJourneyAnnotationsDashboardRoutes().length,3); assert.equal(createJourneyAnnotationsApiRoutes().length,3); assert.equal(createJourneyAnnotationsOpsRoutes().length,3); assert.equal(createJourneyAnnotationsPublicRoutes().length,3); assert.equal(summarizeJourneyAnnotationsFixtures().contacts,2);});
