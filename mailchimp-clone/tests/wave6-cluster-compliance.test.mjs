import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCalendarApprovals, buildCalendarApprovalsSnapshot } from '../packages/calendar-approvals/index.mjs';
import { summarizeComplianceIncidents, buildComplianceIncidentsSnapshot } from '../packages/compliance-incidents/index.mjs';
import { summarizeConsentLedger, buildConsentLedgerSnapshot } from '../packages/consent-ledger/index.mjs';
import { summarizeDeliverabilityWarRoom, buildDeliverabilityWarRoomSnapshot } from '../packages/deliverability-war-room/index.mjs';
import { summarizeServiceRecovery, buildServiceRecoverySnapshot } from '../packages/service-recovery/index.mjs';
import { summarizeTrustAutomation, buildTrustAutomationSnapshot } from '../packages/trust-automation/index.mjs';

test('wave6-cluster-compliance keeps the generated wave 6 modules executable and policy-complete', () => {
  assert.ok(summarizeCalendarApprovals().metricCount >= 4);
  assert.equal(buildCalendarApprovalsSnapshot().validation.ok, true);
  assert.ok(summarizeComplianceIncidents().metricCount >= 4);
  assert.equal(buildComplianceIncidentsSnapshot().validation.ok, true);
  assert.ok(summarizeConsentLedger().metricCount >= 4);
  assert.equal(buildConsentLedgerSnapshot().validation.ok, true);
  assert.ok(summarizeDeliverabilityWarRoom().metricCount >= 4);
  assert.equal(buildDeliverabilityWarRoomSnapshot().validation.ok, true);
  assert.ok(summarizeServiceRecovery().metricCount >= 4);
  assert.equal(buildServiceRecoverySnapshot().validation.ok, true);
  assert.ok(summarizeTrustAutomation().metricCount >= 4);
  assert.equal(buildTrustAutomationSnapshot().validation.ok, true);
});

