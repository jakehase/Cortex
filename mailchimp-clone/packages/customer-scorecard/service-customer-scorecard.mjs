import { createCustomerScorecardWorkspace, summarizeCustomerScorecardWorkspace, createCustomerScorecardNarratives, createCustomerScorecardCoverageGrid } from './domain-customer-scorecard.mjs';
import { createCustomerScorecardPolicies, validateCustomerScorecardPolicies, summarizeCustomerScorecardPolicies, createCustomerScorecardEscalationDeck } from './policies-customer-scorecard.mjs';
import { createCustomerScorecardAnalyticsTimeline, createCustomerScorecardForecastEnvelope, createCustomerScorecardExceptionLedger, summarizeCustomerScorecardAnalytics } from './analytics-customer-scorecard.mjs';
import { createCustomerScorecardOperationsBoard, createCustomerScorecardShiftChecklist, createCustomerScorecardIncidentDeck } from './operations-customer-scorecard.mjs';
import { createCustomerScorecardReportCards, createCustomerScorecardReviewPackets, summarizeCustomerScorecardReporting } from './reporting-customer-scorecard.mjs';
import { createCustomerScorecardAuditTrail, createCustomerScorecardEvidenceManifest, createCustomerScorecardReadinessAttestation } from './audit-customer-scorecard.mjs';
import { createCustomerScorecardPlaybooks, createCustomerScorecardDecisionDeck, createCustomerScorecardEscalationMoments } from './playbooks-customer-scorecard.mjs';

export function buildCustomerScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerScorecardWorkspace(workspaceName);
  const policies = createCustomerScorecardPolicies();
  return {
    workspace,
    summary: summarizeCustomerScorecardWorkspace(workspace),
    narratives: createCustomerScorecardNarratives(workspace),
    coverage: createCustomerScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerScorecardPolicies(policies),
    validation: validateCustomerScorecardPolicies(policies),
    escalationDeck: createCustomerScorecardEscalationDeck(policies),
    analytics: {
      timeline: createCustomerScorecardAnalyticsTimeline(),
      forecast: createCustomerScorecardForecastEnvelope(),
      exceptions: createCustomerScorecardExceptionLedger(),
      summary: summarizeCustomerScorecardAnalytics()
    },
    operations: {
      board: createCustomerScorecardOperationsBoard(),
      checklist: createCustomerScorecardShiftChecklist(),
      incidents: createCustomerScorecardIncidentDeck()
    },
    reporting: {
      cards: createCustomerScorecardReportCards(),
      packets: createCustomerScorecardReviewPackets(),
      summary: summarizeCustomerScorecardReporting()
    },
    audit: {
      trail: createCustomerScorecardAuditTrail(),
      manifest: createCustomerScorecardEvidenceManifest(),
      attestation: createCustomerScorecardReadinessAttestation()
    },
    playbooks: createCustomerScorecardPlaybooks(),
    decisions: createCustomerScorecardDecisionDeck(),
    escalationMoments: createCustomerScorecardEscalationMoments()
  };
}

export function createCustomerScorecardReadinessBoard(snapshot = buildCustomerScorecardSnapshot()) {
  return [
    { id: 'customer-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerScorecardApiDocument(snapshot = buildCustomerScorecardSnapshot()) {
  return {
    id: 'customer-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-scorecard/overview' },
      { method: 'GET', path: '/api/customer-scorecard/reporting' },
      { method: 'POST', path: '/api/customer-scorecard/validate' },
      { method: 'GET', path: '/api/customer-scorecard/audit' }
    ],
    readiness: createCustomerScorecardReadinessBoard(snapshot)
  };
}

export function createCustomerScorecardRouteSummary(snapshot = buildCustomerScorecardSnapshot()) {
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

