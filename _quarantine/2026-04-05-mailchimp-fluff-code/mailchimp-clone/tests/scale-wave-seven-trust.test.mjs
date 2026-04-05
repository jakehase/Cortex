import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceAdvisorSnapshot } from '../packages/compliance-advisor/index.mjs';
import { buildComplianceAtlasSnapshot } from '../packages/compliance-atlas/index.mjs';
import { buildComplianceCockpitSnapshot } from '../packages/compliance-cockpit/index.mjs';
import { buildComplianceConsoleSnapshot } from '../packages/compliance-console/index.mjs';
import { buildComplianceDossierSnapshot } from '../packages/compliance-dossier/index.mjs';
import { buildComplianceExchangeSnapshot } from '../packages/compliance-exchange/index.mjs';

test('scale wave seven trust slice remains executable across sample modules', () => {
  assert.equal(buildComplianceAdvisorSnapshot().validation.ok, true);
  assert.equal(buildComplianceAtlasSnapshot().validation.ok, true);
  assert.equal(buildComplianceCockpitSnapshot().validation.ok, true);
  assert.equal(buildComplianceConsoleSnapshot().validation.ok, true);
  assert.equal(buildComplianceDossierSnapshot().validation.ok, true);
  assert.equal(buildComplianceExchangeSnapshot().validation.ok, true);
});

