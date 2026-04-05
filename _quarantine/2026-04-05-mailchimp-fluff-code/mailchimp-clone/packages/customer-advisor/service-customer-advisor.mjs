import { createCustomerAdvisorWorkspace, summarizeCustomerAdvisorWorkspace, createCustomerAdvisorNarratives, createCustomerAdvisorCoverageGrid } from './domain-customer-advisor.mjs';
import { createCustomerAdvisorPolicies, validateCustomerAdvisorPolicies, summarizeCustomerAdvisorPolicies, createCustomerAdvisorEscalationDeck } from './policies-customer-advisor.mjs';
import { createCustomerAdvisorAnalyticsTimeline, createCustomerAdvisorForecastEnvelope, createCustomerAdvisorExceptionLedger, summarizeCustomerAdvisorAnalytics } from './analytics-customer-advisor.mjs';
import { createCustomerAdvisorOperationsBoard, createCustomerAdvisorShiftChecklist, createCustomerAdvisorIncidentDeck } from './operations-customer-advisor.mjs';
import { createCustomerAdvisorReportCards, createCustomerAdvisorReviewPackets, summarizeCustomerAdvisorReporting } from './reporting-customer-advisor.mjs';
import { createCustomerAdvisorAuditTrail, createCustomerAdvisorEvidenceManifest, createCustomerAdvisorReadinessAttestation } from './audit-customer-advisor.mjs';
import { createCustomerAdvisorPlaybooks, createCustomerAdvisorDecisionDeck, createCustomerAdvisorEscalationMoments } from './playbooks-customer-advisor.mjs';

export function buildCustomerAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerAdvisorWorkspace(workspaceName);
  const policies = createCustomerAdvisorPolicies();
  return {
    workspace,
    summary: summarizeCustomerAdvisorWorkspace(workspace),
    narratives: createCustomerAdvisorNarratives(workspace),
    coverage: createCustomerAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerAdvisorPolicies(policies),
    validation: validateCustomerAdvisorPolicies(policies),
    escalationDeck: createCustomerAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createCustomerAdvisorAnalyticsTimeline(),
      forecast: createCustomerAdvisorForecastEnvelope(),
      exceptions: createCustomerAdvisorExceptionLedger(),
      summary: summarizeCustomerAdvisorAnalytics()
    },
    operations: {
      board: createCustomerAdvisorOperationsBoard(),
      checklist: createCustomerAdvisorShiftChecklist(),
      incidents: createCustomerAdvisorIncidentDeck()
    },
    reporting: {
      cards: createCustomerAdvisorReportCards(),
      packets: createCustomerAdvisorReviewPackets(),
      summary: summarizeCustomerAdvisorReporting()
    },
    audit: {
      trail: createCustomerAdvisorAuditTrail(),
      manifest: createCustomerAdvisorEvidenceManifest(),
      attestation: createCustomerAdvisorReadinessAttestation()
    },
    playbooks: createCustomerAdvisorPlaybooks(),
    decisions: createCustomerAdvisorDecisionDeck(),
    escalationMoments: createCustomerAdvisorEscalationMoments()
  };
}

export function createCustomerAdvisorReadinessBoard(snapshot = buildCustomerAdvisorSnapshot()) {
  return [
    { id: 'customer-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerAdvisorApiDocument(snapshot = buildCustomerAdvisorSnapshot()) {
  return {
    id: 'customer-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-advisor/overview' },
      { method: 'GET', path: '/api/customer-advisor/reporting' },
      { method: 'POST', path: '/api/customer-advisor/validate' },
      { method: 'GET', path: '/api/customer-advisor/audit' }
    ],
    readiness: createCustomerAdvisorReadinessBoard(snapshot)
  };
}

export function createCustomerAdvisorRouteSummary(snapshot = buildCustomerAdvisorSnapshot()) {
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

