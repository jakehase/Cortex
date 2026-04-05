import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsAdvisorSnapshot } from '../packages/analytics-advisor/index.mjs';
import { buildAnalyticsAtlasSnapshot } from '../packages/analytics-atlas/index.mjs';
import { buildAnalyticsCockpitSnapshot } from '../packages/analytics-cockpit/index.mjs';
import { buildAnalyticsConsoleSnapshot } from '../packages/analytics-console/index.mjs';
import { buildAnalyticsDossierSnapshot } from '../packages/analytics-dossier/index.mjs';
import { buildAnalyticsExchangeSnapshot } from '../packages/analytics-exchange/index.mjs';

test('scale wave seven revenue slice remains executable across sample modules', () => {
  assert.equal(buildAnalyticsAdvisorSnapshot().validation.ok, true);
  assert.equal(buildAnalyticsAtlasSnapshot().validation.ok, true);
  assert.equal(buildAnalyticsCockpitSnapshot().validation.ok, true);
  assert.equal(buildAnalyticsConsoleSnapshot().validation.ok, true);
  assert.equal(buildAnalyticsDossierSnapshot().validation.ok, true);
  assert.equal(buildAnalyticsExchangeSnapshot().validation.ok, true);
});

