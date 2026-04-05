import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationAdvisorSnapshot } from '../packages/automation-advisor/index.mjs';
import { buildAutomationAtlasSnapshot } from '../packages/automation-atlas/index.mjs';
import { buildAutomationCockpitSnapshot } from '../packages/automation-cockpit/index.mjs';
import { buildAutomationConsoleSnapshot } from '../packages/automation-console/index.mjs';
import { buildAutomationDossierSnapshot } from '../packages/automation-dossier/index.mjs';
import { buildAutomationExchangeSnapshot } from '../packages/automation-exchange/index.mjs';

test('scale wave seven lifecycle slice remains executable across sample modules', () => {
  assert.equal(buildAutomationAdvisorSnapshot().validation.ok, true);
  assert.equal(buildAutomationAtlasSnapshot().validation.ok, true);
  assert.equal(buildAutomationCockpitSnapshot().validation.ok, true);
  assert.equal(buildAutomationConsoleSnapshot().validation.ok, true);
  assert.equal(buildAutomationDossierSnapshot().validation.ok, true);
  assert.equal(buildAutomationExchangeSnapshot().validation.ok, true);
});

