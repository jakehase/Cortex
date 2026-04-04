import { createBillingCockpitWorkspace, summarizeBillingCockpitWorkspace, createBillingCockpitNarratives, createBillingCockpitCoverageGrid } from './domain-billing-cockpit.mjs';
import { createBillingCockpitPolicies, validateBillingCockpitPolicies, summarizeBillingCockpitPolicies, createBillingCockpitEscalationDeck } from './policies-billing-cockpit.mjs';
import { createBillingCockpitAnalyticsTimeline, createBillingCockpitForecastEnvelope, createBillingCockpitExceptionLedger, summarizeBillingCockpitAnalytics } from './analytics-billing-cockpit.mjs';
import { createBillingCockpitOperationsBoard, createBillingCockpitShiftChecklist, createBillingCockpitIncidentDeck } from './operations-billing-cockpit.mjs';
import { createBillingCockpitReportCards, createBillingCockpitReviewPackets, summarizeBillingCockpitReporting } from './reporting-billing-cockpit.mjs';
import { createBillingCockpitAuditTrail, createBillingCockpitEvidenceManifest, createBillingCockpitReadinessAttestation } from './audit-billing-cockpit.mjs';
import { createBillingCockpitPlaybooks, createBillingCockpitDecisionDeck, createBillingCockpitEscalationMoments } from './playbooks-billing-cockpit.mjs';

export function buildBillingCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingCockpitWorkspace(workspaceName);
  const policies = createBillingCockpitPolicies();
  return {
    workspace,
    summary: summarizeBillingCockpitWorkspace(workspace),
    narratives: createBillingCockpitNarratives(workspace),
    coverage: createBillingCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingCockpitPolicies(policies),
    validation: validateBillingCockpitPolicies(policies),
    escalationDeck: createBillingCockpitEscalationDeck(policies),
    analytics: {
      timeline: createBillingCockpitAnalyticsTimeline(),
      forecast: createBillingCockpitForecastEnvelope(),
      exceptions: createBillingCockpitExceptionLedger(),
      summary: summarizeBillingCockpitAnalytics()
    },
    operations: {
      board: createBillingCockpitOperationsBoard(),
      checklist: createBillingCockpitShiftChecklist(),
      incidents: createBillingCockpitIncidentDeck()
    },
    reporting: {
      cards: createBillingCockpitReportCards(),
      packets: createBillingCockpitReviewPackets(),
      summary: summarizeBillingCockpitReporting()
    },
    audit: {
      trail: createBillingCockpitAuditTrail(),
      manifest: createBillingCockpitEvidenceManifest(),
      attestation: createBillingCockpitReadinessAttestation()
    },
    playbooks: createBillingCockpitPlaybooks(),
    decisions: createBillingCockpitDecisionDeck(),
    escalationMoments: createBillingCockpitEscalationMoments()
  };
}

export function createBillingCockpitReadinessBoard(snapshot = buildBillingCockpitSnapshot()) {
  return [
    { id: 'billing-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingCockpitApiDocument(snapshot = buildBillingCockpitSnapshot()) {
  return {
    id: 'billing-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-cockpit/overview' },
      { method: 'GET', path: '/api/billing-cockpit/reporting' },
      { method: 'POST', path: '/api/billing-cockpit/validate' },
      { method: 'GET', path: '/api/billing-cockpit/audit' }
    ],
    readiness: createBillingCockpitReadinessBoard(snapshot)
  };
}

export function createBillingCockpitRouteSummary(snapshot = buildBillingCockpitSnapshot()) {
  return {
    id: snapshot.workspace.id,
    title: snapshot.summary.title,
    focus: snapshot.workspace.focus,
    groupTitle: snapshot.summary.groupTitle,
    metricCount: snapshot.summary.metricCount,
    policyCount: snapshot.policySummary.total,
    executiveCards: snapshot.reporting.summary.executiveCards
  };
}

