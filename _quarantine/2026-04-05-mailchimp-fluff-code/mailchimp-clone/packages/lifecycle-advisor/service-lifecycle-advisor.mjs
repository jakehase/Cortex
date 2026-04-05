import { createLifecycleAdvisorWorkspace, summarizeLifecycleAdvisorWorkspace, createLifecycleAdvisorNarratives, createLifecycleAdvisorCoverageGrid } from './domain-lifecycle-advisor.mjs';
import { createLifecycleAdvisorPolicies, validateLifecycleAdvisorPolicies, summarizeLifecycleAdvisorPolicies, createLifecycleAdvisorEscalationDeck } from './policies-lifecycle-advisor.mjs';
import { createLifecycleAdvisorAnalyticsTimeline, createLifecycleAdvisorForecastEnvelope, createLifecycleAdvisorExceptionLedger, summarizeLifecycleAdvisorAnalytics } from './analytics-lifecycle-advisor.mjs';
import { createLifecycleAdvisorOperationsBoard, createLifecycleAdvisorShiftChecklist, createLifecycleAdvisorIncidentDeck } from './operations-lifecycle-advisor.mjs';
import { createLifecycleAdvisorReportCards, createLifecycleAdvisorReviewPackets, summarizeLifecycleAdvisorReporting } from './reporting-lifecycle-advisor.mjs';
import { createLifecycleAdvisorAuditTrail, createLifecycleAdvisorEvidenceManifest, createLifecycleAdvisorReadinessAttestation } from './audit-lifecycle-advisor.mjs';
import { createLifecycleAdvisorPlaybooks, createLifecycleAdvisorDecisionDeck, createLifecycleAdvisorEscalationMoments } from './playbooks-lifecycle-advisor.mjs';

export function buildLifecycleAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleAdvisorWorkspace(workspaceName);
  const policies = createLifecycleAdvisorPolicies();
  return {
    workspace,
    summary: summarizeLifecycleAdvisorWorkspace(workspace),
    narratives: createLifecycleAdvisorNarratives(workspace),
    coverage: createLifecycleAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleAdvisorPolicies(policies),
    validation: validateLifecycleAdvisorPolicies(policies),
    escalationDeck: createLifecycleAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleAdvisorAnalyticsTimeline(),
      forecast: createLifecycleAdvisorForecastEnvelope(),
      exceptions: createLifecycleAdvisorExceptionLedger(),
      summary: summarizeLifecycleAdvisorAnalytics()
    },
    operations: {
      board: createLifecycleAdvisorOperationsBoard(),
      checklist: createLifecycleAdvisorShiftChecklist(),
      incidents: createLifecycleAdvisorIncidentDeck()
    },
    reporting: {
      cards: createLifecycleAdvisorReportCards(),
      packets: createLifecycleAdvisorReviewPackets(),
      summary: summarizeLifecycleAdvisorReporting()
    },
    audit: {
      trail: createLifecycleAdvisorAuditTrail(),
      manifest: createLifecycleAdvisorEvidenceManifest(),
      attestation: createLifecycleAdvisorReadinessAttestation()
    },
    playbooks: createLifecycleAdvisorPlaybooks(),
    decisions: createLifecycleAdvisorDecisionDeck(),
    escalationMoments: createLifecycleAdvisorEscalationMoments()
  };
}

export function createLifecycleAdvisorReadinessBoard(snapshot = buildLifecycleAdvisorSnapshot()) {
  return [
    { id: 'lifecycle-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleAdvisorApiDocument(snapshot = buildLifecycleAdvisorSnapshot()) {
  return {
    id: 'lifecycle-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-advisor/overview' },
      { method: 'GET', path: '/api/lifecycle-advisor/reporting' },
      { method: 'POST', path: '/api/lifecycle-advisor/validate' },
      { method: 'GET', path: '/api/lifecycle-advisor/audit' }
    ],
    readiness: createLifecycleAdvisorReadinessBoard(snapshot)
  };
}

export function createLifecycleAdvisorRouteSummary(snapshot = buildLifecycleAdvisorSnapshot()) {
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

