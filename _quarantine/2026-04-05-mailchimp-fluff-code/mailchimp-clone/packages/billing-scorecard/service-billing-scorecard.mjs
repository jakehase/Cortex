import { createBillingScorecardWorkspace, summarizeBillingScorecardWorkspace, createBillingScorecardNarratives, createBillingScorecardCoverageGrid } from './domain-billing-scorecard.mjs';
import { createBillingScorecardPolicies, validateBillingScorecardPolicies, summarizeBillingScorecardPolicies, createBillingScorecardEscalationDeck } from './policies-billing-scorecard.mjs';
import { createBillingScorecardAnalyticsTimeline, createBillingScorecardForecastEnvelope, createBillingScorecardExceptionLedger, summarizeBillingScorecardAnalytics } from './analytics-billing-scorecard.mjs';
import { createBillingScorecardOperationsBoard, createBillingScorecardShiftChecklist, createBillingScorecardIncidentDeck } from './operations-billing-scorecard.mjs';
import { createBillingScorecardReportCards, createBillingScorecardReviewPackets, summarizeBillingScorecardReporting } from './reporting-billing-scorecard.mjs';
import { createBillingScorecardAuditTrail, createBillingScorecardEvidenceManifest, createBillingScorecardReadinessAttestation } from './audit-billing-scorecard.mjs';
import { createBillingScorecardPlaybooks, createBillingScorecardDecisionDeck, createBillingScorecardEscalationMoments } from './playbooks-billing-scorecard.mjs';

export function buildBillingScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingScorecardWorkspace(workspaceName);
  const policies = createBillingScorecardPolicies();
  return {
    workspace,
    summary: summarizeBillingScorecardWorkspace(workspace),
    narratives: createBillingScorecardNarratives(workspace),
    coverage: createBillingScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingScorecardPolicies(policies),
    validation: validateBillingScorecardPolicies(policies),
    escalationDeck: createBillingScorecardEscalationDeck(policies),
    analytics: {
      timeline: createBillingScorecardAnalyticsTimeline(),
      forecast: createBillingScorecardForecastEnvelope(),
      exceptions: createBillingScorecardExceptionLedger(),
      summary: summarizeBillingScorecardAnalytics()
    },
    operations: {
      board: createBillingScorecardOperationsBoard(),
      checklist: createBillingScorecardShiftChecklist(),
      incidents: createBillingScorecardIncidentDeck()
    },
    reporting: {
      cards: createBillingScorecardReportCards(),
      packets: createBillingScorecardReviewPackets(),
      summary: summarizeBillingScorecardReporting()
    },
    audit: {
      trail: createBillingScorecardAuditTrail(),
      manifest: createBillingScorecardEvidenceManifest(),
      attestation: createBillingScorecardReadinessAttestation()
    },
    playbooks: createBillingScorecardPlaybooks(),
    decisions: createBillingScorecardDecisionDeck(),
    escalationMoments: createBillingScorecardEscalationMoments()
  };
}

export function createBillingScorecardReadinessBoard(snapshot = buildBillingScorecardSnapshot()) {
  return [
    { id: 'billing-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingScorecardApiDocument(snapshot = buildBillingScorecardSnapshot()) {
  return {
    id: 'billing-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-scorecard/overview' },
      { method: 'GET', path: '/api/billing-scorecard/reporting' },
      { method: 'POST', path: '/api/billing-scorecard/validate' },
      { method: 'GET', path: '/api/billing-scorecard/audit' }
    ],
    readiness: createBillingScorecardReadinessBoard(snapshot)
  };
}

export function createBillingScorecardRouteSummary(snapshot = buildBillingScorecardSnapshot()) {
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

