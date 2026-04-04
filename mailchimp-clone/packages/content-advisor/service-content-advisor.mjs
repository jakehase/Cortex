import { createContentAdvisorWorkspace, summarizeContentAdvisorWorkspace, createContentAdvisorNarratives, createContentAdvisorCoverageGrid } from './domain-content-advisor.mjs';
import { createContentAdvisorPolicies, validateContentAdvisorPolicies, summarizeContentAdvisorPolicies, createContentAdvisorEscalationDeck } from './policies-content-advisor.mjs';
import { createContentAdvisorAnalyticsTimeline, createContentAdvisorForecastEnvelope, createContentAdvisorExceptionLedger, summarizeContentAdvisorAnalytics } from './analytics-content-advisor.mjs';
import { createContentAdvisorOperationsBoard, createContentAdvisorShiftChecklist, createContentAdvisorIncidentDeck } from './operations-content-advisor.mjs';
import { createContentAdvisorReportCards, createContentAdvisorReviewPackets, summarizeContentAdvisorReporting } from './reporting-content-advisor.mjs';
import { createContentAdvisorAuditTrail, createContentAdvisorEvidenceManifest, createContentAdvisorReadinessAttestation } from './audit-content-advisor.mjs';
import { createContentAdvisorPlaybooks, createContentAdvisorDecisionDeck, createContentAdvisorEscalationMoments } from './playbooks-content-advisor.mjs';

export function buildContentAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentAdvisorWorkspace(workspaceName);
  const policies = createContentAdvisorPolicies();
  return {
    workspace,
    summary: summarizeContentAdvisorWorkspace(workspace),
    narratives: createContentAdvisorNarratives(workspace),
    coverage: createContentAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentAdvisorPolicies(policies),
    validation: validateContentAdvisorPolicies(policies),
    escalationDeck: createContentAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createContentAdvisorAnalyticsTimeline(),
      forecast: createContentAdvisorForecastEnvelope(),
      exceptions: createContentAdvisorExceptionLedger(),
      summary: summarizeContentAdvisorAnalytics()
    },
    operations: {
      board: createContentAdvisorOperationsBoard(),
      checklist: createContentAdvisorShiftChecklist(),
      incidents: createContentAdvisorIncidentDeck()
    },
    reporting: {
      cards: createContentAdvisorReportCards(),
      packets: createContentAdvisorReviewPackets(),
      summary: summarizeContentAdvisorReporting()
    },
    audit: {
      trail: createContentAdvisorAuditTrail(),
      manifest: createContentAdvisorEvidenceManifest(),
      attestation: createContentAdvisorReadinessAttestation()
    },
    playbooks: createContentAdvisorPlaybooks(),
    decisions: createContentAdvisorDecisionDeck(),
    escalationMoments: createContentAdvisorEscalationMoments()
  };
}

export function createContentAdvisorReadinessBoard(snapshot = buildContentAdvisorSnapshot()) {
  return [
    { id: 'content-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentAdvisorApiDocument(snapshot = buildContentAdvisorSnapshot()) {
  return {
    id: 'content-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-advisor/overview' },
      { method: 'GET', path: '/api/content-advisor/reporting' },
      { method: 'POST', path: '/api/content-advisor/validate' },
      { method: 'GET', path: '/api/content-advisor/audit' }
    ],
    readiness: createContentAdvisorReadinessBoard(snapshot)
  };
}

export function createContentAdvisorRouteSummary(snapshot = buildContentAdvisorSnapshot()) {
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

