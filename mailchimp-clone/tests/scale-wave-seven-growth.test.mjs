import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionAdvisorSnapshot } from '../packages/acquisition-advisor/index.mjs';
import { buildAcquisitionAtlasSnapshot } from '../packages/acquisition-atlas/index.mjs';
import { buildAcquisitionCockpitSnapshot } from '../packages/acquisition-cockpit/index.mjs';
import { buildAcquisitionConsoleSnapshot } from '../packages/acquisition-console/index.mjs';
import { buildAcquisitionDossierSnapshot } from '../packages/acquisition-dossier/index.mjs';
import { buildAcquisitionExchangeSnapshot } from '../packages/acquisition-exchange/index.mjs';

test('scale wave seven growth slice remains executable across sample modules', () => {
  assert.equal(buildAcquisitionAdvisorSnapshot().validation.ok, true);
  assert.equal(buildAcquisitionAtlasSnapshot().validation.ok, true);
  assert.equal(buildAcquisitionCockpitSnapshot().validation.ok, true);
  assert.equal(buildAcquisitionConsoleSnapshot().validation.ok, true);
  assert.equal(buildAcquisitionDossierSnapshot().validation.ok, true);
  assert.equal(buildAcquisitionExchangeSnapshot().validation.ok, true);
});

