import { createAdvocacyAdvisorWorkspace, summarizeAdvocacyAdvisorWorkspace, createAdvocacyAdvisorNarratives, createAdvocacyAdvisorCoverageGrid } from './domain-advocacy-advisor.mjs';
import { createAdvocacyAdvisorPolicies, validateAdvocacyAdvisorPolicies, summarizeAdvocacyAdvisorPolicies, createAdvocacyAdvisorEscalationDeck } from './policies-advocacy-advisor.mjs';
import { createAdvocacyAdvisorAnalyticsTimeline, createAdvocacyAdvisorForecastEnvelope, createAdvocacyAdvisorExceptionLedger, summarizeAdvocacyAdvisorAnalytics } from './analytics-advocacy-advisor.mjs';
import { createAdvocacyAdvisorOperationsBoard, createAdvocacyAdvisorShiftChecklist, createAdvocacyAdvisorIncidentDeck } from './operations-advocacy-advisor.mjs';
import { createAdvocacyAdvisorReportCards, createAdvocacyAdvisorReviewPackets, summarizeAdvocacyAdvisorReporting } from './reporting-advocacy-advisor.mjs';
import { createAdvocacyAdvisorAuditTrail, createAdvocacyAdvisorEvidenceManifest, createAdvocacyAdvisorReadinessAttestation } from './audit-advocacy-advisor.mjs';
import { createAdvocacyAdvisorPlaybooks, createAdvocacyAdvisorDecisionDeck, createAdvocacyAdvisorEscalationMoments } from './playbooks-advocacy-advisor.mjs';

export function buildAdvocacyAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyAdvisorWorkspace(workspaceName);
  const policies = createAdvocacyAdvisorPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyAdvisorWorkspace(workspace),
    narratives: createAdvocacyAdvisorNarratives(workspace),
    coverage: createAdvocacyAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyAdvisorPolicies(policies),
    validation: validateAdvocacyAdvisorPolicies(policies),
    escalationDeck: createAdvocacyAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyAdvisorAnalyticsTimeline(),
      forecast: createAdvocacyAdvisorForecastEnvelope(),
      exceptions: createAdvocacyAdvisorExceptionLedger(),
      summary: summarizeAdvocacyAdvisorAnalytics()
    },
    operations: {
      board: createAdvocacyAdvisorOperationsBoard(),
      checklist: createAdvocacyAdvisorShiftChecklist(),
      incidents: createAdvocacyAdvisorIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyAdvisorReportCards(),
      packets: createAdvocacyAdvisorReviewPackets(),
      summary: summarizeAdvocacyAdvisorReporting()
    },
    audit: {
      trail: createAdvocacyAdvisorAuditTrail(),
      manifest: createAdvocacyAdvisorEvidenceManifest(),
      attestation: createAdvocacyAdvisorReadinessAttestation()
    },
    playbooks: createAdvocacyAdvisorPlaybooks(),
    decisions: createAdvocacyAdvisorDecisionDeck(),
    escalationMoments: createAdvocacyAdvisorEscalationMoments()
  };
}

export function createAdvocacyAdvisorReadinessBoard(snapshot = buildAdvocacyAdvisorSnapshot()) {
  return [
    { id: 'advocacy-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyAdvisorApiDocument(snapshot = buildAdvocacyAdvisorSnapshot()) {
  return {
    id: 'advocacy-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-advisor/overview' },
      { method: 'GET', path: '/api/advocacy-advisor/reporting' },
      { method: 'POST', path: '/api/advocacy-advisor/validate' },
      { method: 'GET', path: '/api/advocacy-advisor/audit' }
    ],
    readiness: createAdvocacyAdvisorReadinessBoard(snapshot)
  };
}

export function createAdvocacyAdvisorRouteSummary(snapshot = buildAdvocacyAdvisorSnapshot()) {
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

