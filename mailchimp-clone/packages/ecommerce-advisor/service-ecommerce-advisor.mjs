import { createEcommerceAdvisorWorkspace, summarizeEcommerceAdvisorWorkspace, createEcommerceAdvisorNarratives, createEcommerceAdvisorCoverageGrid } from './domain-ecommerce-advisor.mjs';
import { createEcommerceAdvisorPolicies, validateEcommerceAdvisorPolicies, summarizeEcommerceAdvisorPolicies, createEcommerceAdvisorEscalationDeck } from './policies-ecommerce-advisor.mjs';
import { createEcommerceAdvisorAnalyticsTimeline, createEcommerceAdvisorForecastEnvelope, createEcommerceAdvisorExceptionLedger, summarizeEcommerceAdvisorAnalytics } from './analytics-ecommerce-advisor.mjs';
import { createEcommerceAdvisorOperationsBoard, createEcommerceAdvisorShiftChecklist, createEcommerceAdvisorIncidentDeck } from './operations-ecommerce-advisor.mjs';
import { createEcommerceAdvisorReportCards, createEcommerceAdvisorReviewPackets, summarizeEcommerceAdvisorReporting } from './reporting-ecommerce-advisor.mjs';
import { createEcommerceAdvisorAuditTrail, createEcommerceAdvisorEvidenceManifest, createEcommerceAdvisorReadinessAttestation } from './audit-ecommerce-advisor.mjs';
import { createEcommerceAdvisorPlaybooks, createEcommerceAdvisorDecisionDeck, createEcommerceAdvisorEscalationMoments } from './playbooks-ecommerce-advisor.mjs';

export function buildEcommerceAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceAdvisorWorkspace(workspaceName);
  const policies = createEcommerceAdvisorPolicies();
  return {
    workspace,
    summary: summarizeEcommerceAdvisorWorkspace(workspace),
    narratives: createEcommerceAdvisorNarratives(workspace),
    coverage: createEcommerceAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceAdvisorPolicies(policies),
    validation: validateEcommerceAdvisorPolicies(policies),
    escalationDeck: createEcommerceAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceAdvisorAnalyticsTimeline(),
      forecast: createEcommerceAdvisorForecastEnvelope(),
      exceptions: createEcommerceAdvisorExceptionLedger(),
      summary: summarizeEcommerceAdvisorAnalytics()
    },
    operations: {
      board: createEcommerceAdvisorOperationsBoard(),
      checklist: createEcommerceAdvisorShiftChecklist(),
      incidents: createEcommerceAdvisorIncidentDeck()
    },
    reporting: {
      cards: createEcommerceAdvisorReportCards(),
      packets: createEcommerceAdvisorReviewPackets(),
      summary: summarizeEcommerceAdvisorReporting()
    },
    audit: {
      trail: createEcommerceAdvisorAuditTrail(),
      manifest: createEcommerceAdvisorEvidenceManifest(),
      attestation: createEcommerceAdvisorReadinessAttestation()
    },
    playbooks: createEcommerceAdvisorPlaybooks(),
    decisions: createEcommerceAdvisorDecisionDeck(),
    escalationMoments: createEcommerceAdvisorEscalationMoments()
  };
}

export function createEcommerceAdvisorReadinessBoard(snapshot = buildEcommerceAdvisorSnapshot()) {
  return [
    { id: 'ecommerce-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceAdvisorApiDocument(snapshot = buildEcommerceAdvisorSnapshot()) {
  return {
    id: 'ecommerce-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-advisor/overview' },
      { method: 'GET', path: '/api/ecommerce-advisor/reporting' },
      { method: 'POST', path: '/api/ecommerce-advisor/validate' },
      { method: 'GET', path: '/api/ecommerce-advisor/audit' }
    ],
    readiness: createEcommerceAdvisorReadinessBoard(snapshot)
  };
}

export function createEcommerceAdvisorRouteSummary(snapshot = buildEcommerceAdvisorSnapshot()) {
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

