import { createCommerceAdvisorWorkspace, summarizeCommerceAdvisorWorkspace, createCommerceAdvisorNarratives, createCommerceAdvisorCoverageGrid } from './domain-commerce-advisor.mjs';
import { createCommerceAdvisorPolicies, validateCommerceAdvisorPolicies, summarizeCommerceAdvisorPolicies, createCommerceAdvisorEscalationDeck } from './policies-commerce-advisor.mjs';
import { createCommerceAdvisorAnalyticsTimeline, createCommerceAdvisorForecastEnvelope, createCommerceAdvisorExceptionLedger, summarizeCommerceAdvisorAnalytics } from './analytics-commerce-advisor.mjs';
import { createCommerceAdvisorOperationsBoard, createCommerceAdvisorShiftChecklist, createCommerceAdvisorIncidentDeck } from './operations-commerce-advisor.mjs';
import { createCommerceAdvisorReportCards, createCommerceAdvisorReviewPackets, summarizeCommerceAdvisorReporting } from './reporting-commerce-advisor.mjs';
import { createCommerceAdvisorAuditTrail, createCommerceAdvisorEvidenceManifest, createCommerceAdvisorReadinessAttestation } from './audit-commerce-advisor.mjs';
import { createCommerceAdvisorPlaybooks, createCommerceAdvisorDecisionDeck, createCommerceAdvisorEscalationMoments } from './playbooks-commerce-advisor.mjs';

export function buildCommerceAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceAdvisorWorkspace(workspaceName);
  const policies = createCommerceAdvisorPolicies();
  return {
    workspace,
    summary: summarizeCommerceAdvisorWorkspace(workspace),
    narratives: createCommerceAdvisorNarratives(workspace),
    coverage: createCommerceAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceAdvisorPolicies(policies),
    validation: validateCommerceAdvisorPolicies(policies),
    escalationDeck: createCommerceAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createCommerceAdvisorAnalyticsTimeline(),
      forecast: createCommerceAdvisorForecastEnvelope(),
      exceptions: createCommerceAdvisorExceptionLedger(),
      summary: summarizeCommerceAdvisorAnalytics()
    },
    operations: {
      board: createCommerceAdvisorOperationsBoard(),
      checklist: createCommerceAdvisorShiftChecklist(),
      incidents: createCommerceAdvisorIncidentDeck()
    },
    reporting: {
      cards: createCommerceAdvisorReportCards(),
      packets: createCommerceAdvisorReviewPackets(),
      summary: summarizeCommerceAdvisorReporting()
    },
    audit: {
      trail: createCommerceAdvisorAuditTrail(),
      manifest: createCommerceAdvisorEvidenceManifest(),
      attestation: createCommerceAdvisorReadinessAttestation()
    },
    playbooks: createCommerceAdvisorPlaybooks(),
    decisions: createCommerceAdvisorDecisionDeck(),
    escalationMoments: createCommerceAdvisorEscalationMoments()
  };
}

export function createCommerceAdvisorReadinessBoard(snapshot = buildCommerceAdvisorSnapshot()) {
  return [
    { id: 'commerce-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceAdvisorApiDocument(snapshot = buildCommerceAdvisorSnapshot()) {
  return {
    id: 'commerce-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-advisor/overview' },
      { method: 'GET', path: '/api/commerce-advisor/reporting' },
      { method: 'POST', path: '/api/commerce-advisor/validate' },
      { method: 'GET', path: '/api/commerce-advisor/audit' }
    ],
    readiness: createCommerceAdvisorReadinessBoard(snapshot)
  };
}

export function createCommerceAdvisorRouteSummary(snapshot = buildCommerceAdvisorSnapshot()) {
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

