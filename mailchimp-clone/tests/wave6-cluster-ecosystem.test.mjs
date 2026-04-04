import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLocalizationQa, buildLocalizationQaSnapshot } from '../packages/localization-qa/index.mjs';
import { summarizePartnerCertification, buildPartnerCertificationSnapshot } from '../packages/partner-certification/index.mjs';
import { summarizeReleaseCommandCenter, buildReleaseCommandCenterSnapshot } from '../packages/release-command-center/index.mjs';
import { summarizeTemplateApprovals, buildTemplateApprovalsSnapshot } from '../packages/template-approvals/index.mjs';
import { summarizeTemplateVariants, buildTemplateVariantsSnapshot } from '../packages/template-variants/index.mjs';
import { summarizeWebhookInspector, buildWebhookInspectorSnapshot } from '../packages/webhook-inspector/index.mjs';

test('wave6-cluster-ecosystem keeps the generated wave 6 modules executable and policy-complete', () => {
  assert.ok(summarizeLocalizationQa().metricCount >= 4);
  assert.equal(buildLocalizationQaSnapshot().validation.ok, true);
  assert.ok(summarizePartnerCertification().metricCount >= 4);
  assert.equal(buildPartnerCertificationSnapshot().validation.ok, true);
  assert.ok(summarizeReleaseCommandCenter().metricCount >= 4);
  assert.equal(buildReleaseCommandCenterSnapshot().validation.ok, true);
  assert.ok(summarizeTemplateApprovals().metricCount >= 4);
  assert.equal(buildTemplateApprovalsSnapshot().validation.ok, true);
  assert.ok(summarizeTemplateVariants().metricCount >= 4);
  assert.equal(buildTemplateVariantsSnapshot().validation.ok, true);
  assert.ok(summarizeWebhookInspector().metricCount >= 4);
  assert.equal(buildWebhookInspectorSnapshot().validation.ok, true);
});

