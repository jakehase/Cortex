import { createLoyaltyAdvisorWorkspace, summarizeLoyaltyAdvisorWorkspace, createLoyaltyAdvisorNarratives, createLoyaltyAdvisorCoverageGrid } from './domain-loyalty-advisor.mjs';
import { createLoyaltyAdvisorPolicies, validateLoyaltyAdvisorPolicies, summarizeLoyaltyAdvisorPolicies, createLoyaltyAdvisorEscalationDeck } from './policies-loyalty-advisor.mjs';
import { createLoyaltyAdvisorAnalyticsTimeline, createLoyaltyAdvisorForecastEnvelope, createLoyaltyAdvisorExceptionLedger, summarizeLoyaltyAdvisorAnalytics } from './analytics-loyalty-advisor.mjs';
import { createLoyaltyAdvisorOperationsBoard, createLoyaltyAdvisorShiftChecklist, createLoyaltyAdvisorIncidentDeck } from './operations-loyalty-advisor.mjs';
import { createLoyaltyAdvisorReportCards, createLoyaltyAdvisorReviewPackets, summarizeLoyaltyAdvisorReporting } from './reporting-loyalty-advisor.mjs';
import { createLoyaltyAdvisorAuditTrail, createLoyaltyAdvisorEvidenceManifest, createLoyaltyAdvisorReadinessAttestation } from './audit-loyalty-advisor.mjs';
import { createLoyaltyAdvisorPlaybooks, createLoyaltyAdvisorDecisionDeck, createLoyaltyAdvisorEscalationMoments } from './playbooks-loyalty-advisor.mjs';

export function buildLoyaltyAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyAdvisorWorkspace(workspaceName);
  const policies = createLoyaltyAdvisorPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyAdvisorWorkspace(workspace),
    narratives: createLoyaltyAdvisorNarratives(workspace),
    coverage: createLoyaltyAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyAdvisorPolicies(policies),
    validation: validateLoyaltyAdvisorPolicies(policies),
    escalationDeck: createLoyaltyAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyAdvisorAnalyticsTimeline(),
      forecast: createLoyaltyAdvisorForecastEnvelope(),
      exceptions: createLoyaltyAdvisorExceptionLedger(),
      summary: summarizeLoyaltyAdvisorAnalytics()
    },
    operations: {
      board: createLoyaltyAdvisorOperationsBoard(),
      checklist: createLoyaltyAdvisorShiftChecklist(),
      incidents: createLoyaltyAdvisorIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyAdvisorReportCards(),
      packets: createLoyaltyAdvisorReviewPackets(),
      summary: summarizeLoyaltyAdvisorReporting()
    },
    audit: {
      trail: createLoyaltyAdvisorAuditTrail(),
      manifest: createLoyaltyAdvisorEvidenceManifest(),
      attestation: createLoyaltyAdvisorReadinessAttestation()
    },
    playbooks: createLoyaltyAdvisorPlaybooks(),
    decisions: createLoyaltyAdvisorDecisionDeck(),
    escalationMoments: createLoyaltyAdvisorEscalationMoments()
  };
}

export function createLoyaltyAdvisorReadinessBoard(snapshot = buildLoyaltyAdvisorSnapshot()) {
  return [
    { id: 'loyalty-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyAdvisorApiDocument(snapshot = buildLoyaltyAdvisorSnapshot()) {
  return {
    id: 'loyalty-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-advisor/overview' },
      { method: 'GET', path: '/api/loyalty-advisor/reporting' },
      { method: 'POST', path: '/api/loyalty-advisor/validate' },
      { method: 'GET', path: '/api/loyalty-advisor/audit' }
    ],
    readiness: createLoyaltyAdvisorReadinessBoard(snapshot)
  };
}

export function createLoyaltyAdvisorRouteSummary(snapshot = buildLoyaltyAdvisorSnapshot()) {
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

