import { createBillingAdvisorWorkspace, summarizeBillingAdvisorWorkspace, createBillingAdvisorNarratives, createBillingAdvisorCoverageGrid } from './domain-billing-advisor.mjs';
import { createBillingAdvisorPolicies, validateBillingAdvisorPolicies, summarizeBillingAdvisorPolicies, createBillingAdvisorEscalationDeck } from './policies-billing-advisor.mjs';
import { createBillingAdvisorAnalyticsTimeline, createBillingAdvisorForecastEnvelope, createBillingAdvisorExceptionLedger, summarizeBillingAdvisorAnalytics } from './analytics-billing-advisor.mjs';
import { createBillingAdvisorOperationsBoard, createBillingAdvisorShiftChecklist, createBillingAdvisorIncidentDeck } from './operations-billing-advisor.mjs';
import { createBillingAdvisorReportCards, createBillingAdvisorReviewPackets, summarizeBillingAdvisorReporting } from './reporting-billing-advisor.mjs';
import { createBillingAdvisorAuditTrail, createBillingAdvisorEvidenceManifest, createBillingAdvisorReadinessAttestation } from './audit-billing-advisor.mjs';
import { createBillingAdvisorPlaybooks, createBillingAdvisorDecisionDeck, createBillingAdvisorEscalationMoments } from './playbooks-billing-advisor.mjs';

export function buildBillingAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingAdvisorWorkspace(workspaceName);
  const policies = createBillingAdvisorPolicies();
  return {
    workspace,
    summary: summarizeBillingAdvisorWorkspace(workspace),
    narratives: createBillingAdvisorNarratives(workspace),
    coverage: createBillingAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingAdvisorPolicies(policies),
    validation: validateBillingAdvisorPolicies(policies),
    escalationDeck: createBillingAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createBillingAdvisorAnalyticsTimeline(),
      forecast: createBillingAdvisorForecastEnvelope(),
      exceptions: createBillingAdvisorExceptionLedger(),
      summary: summarizeBillingAdvisorAnalytics()
    },
    operations: {
      board: createBillingAdvisorOperationsBoard(),
      checklist: createBillingAdvisorShiftChecklist(),
      incidents: createBillingAdvisorIncidentDeck()
    },
    reporting: {
      cards: createBillingAdvisorReportCards(),
      packets: createBillingAdvisorReviewPackets(),
      summary: summarizeBillingAdvisorReporting()
    },
    audit: {
      trail: createBillingAdvisorAuditTrail(),
      manifest: createBillingAdvisorEvidenceManifest(),
      attestation: createBillingAdvisorReadinessAttestation()
    },
    playbooks: createBillingAdvisorPlaybooks(),
    decisions: createBillingAdvisorDecisionDeck(),
    escalationMoments: createBillingAdvisorEscalationMoments()
  };
}

export function createBillingAdvisorReadinessBoard(snapshot = buildBillingAdvisorSnapshot()) {
  return [
    { id: 'billing-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingAdvisorApiDocument(snapshot = buildBillingAdvisorSnapshot()) {
  return {
    id: 'billing-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-advisor/overview' },
      { method: 'GET', path: '/api/billing-advisor/reporting' },
      { method: 'POST', path: '/api/billing-advisor/validate' },
      { method: 'GET', path: '/api/billing-advisor/audit' }
    ],
    readiness: createBillingAdvisorReadinessBoard(snapshot)
  };
}

export function createBillingAdvisorRouteSummary(snapshot = buildBillingAdvisorSnapshot()) {
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

