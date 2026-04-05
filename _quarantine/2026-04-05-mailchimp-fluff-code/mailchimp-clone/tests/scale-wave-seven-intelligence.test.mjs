import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionAdvisorSnapshot } from '../packages/attribution-advisor/index.mjs';
import { buildAttributionAtlasSnapshot } from '../packages/attribution-atlas/index.mjs';
import { buildAttributionCockpitSnapshot } from '../packages/attribution-cockpit/index.mjs';
import { buildAttributionConsoleSnapshot } from '../packages/attribution-console/index.mjs';
import { buildAttributionDossierSnapshot } from '../packages/attribution-dossier/index.mjs';
import { buildAttributionExchangeSnapshot } from '../packages/attribution-exchange/index.mjs';

test('scale wave seven intelligence slice remains executable across sample modules', () => {
  assert.equal(buildAttributionAdvisorSnapshot().validation.ok, true);
  assert.equal(buildAttributionAtlasSnapshot().validation.ok, true);
  assert.equal(buildAttributionCockpitSnapshot().validation.ok, true);
  assert.equal(buildAttributionConsoleSnapshot().validation.ok, true);
  assert.equal(buildAttributionDossierSnapshot().validation.ok, true);
  assert.equal(buildAttributionExchangeSnapshot().validation.ok, true);
});

