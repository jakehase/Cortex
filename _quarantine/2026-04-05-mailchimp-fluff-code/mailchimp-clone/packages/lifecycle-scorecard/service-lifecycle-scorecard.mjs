import { createLifecycleScorecardWorkspace, summarizeLifecycleScorecardWorkspace, createLifecycleScorecardNarratives, createLifecycleScorecardCoverageGrid } from './domain-lifecycle-scorecard.mjs';
import { createLifecycleScorecardPolicies, validateLifecycleScorecardPolicies, summarizeLifecycleScorecardPolicies, createLifecycleScorecardEscalationDeck } from './policies-lifecycle-scorecard.mjs';
import { createLifecycleScorecardAnalyticsTimeline, createLifecycleScorecardForecastEnvelope, createLifecycleScorecardExceptionLedger, summarizeLifecycleScorecardAnalytics } from './analytics-lifecycle-scorecard.mjs';
import { createLifecycleScorecardOperationsBoard, createLifecycleScorecardShiftChecklist, createLifecycleScorecardIncidentDeck } from './operations-lifecycle-scorecard.mjs';
import { createLifecycleScorecardReportCards, createLifecycleScorecardReviewPackets, summarizeLifecycleScorecardReporting } from './reporting-lifecycle-scorecard.mjs';
import { createLifecycleScorecardAuditTrail, createLifecycleScorecardEvidenceManifest, createLifecycleScorecardReadinessAttestation } from './audit-lifecycle-scorecard.mjs';
import { createLifecycleScorecardPlaybooks, createLifecycleScorecardDecisionDeck, createLifecycleScorecardEscalationMoments } from './playbooks-lifecycle-scorecard.mjs';

export function buildLifecycleScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleScorecardWorkspace(workspaceName);
  const policies = createLifecycleScorecardPolicies();
  return {
    workspace,
    summary: summarizeLifecycleScorecardWorkspace(workspace),
    narratives: createLifecycleScorecardNarratives(workspace),
    coverage: createLifecycleScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleScorecardPolicies(policies),
    validation: validateLifecycleScorecardPolicies(policies),
    escalationDeck: createLifecycleScorecardEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleScorecardAnalyticsTimeline(),
      forecast: createLifecycleScorecardForecastEnvelope(),
      exceptions: createLifecycleScorecardExceptionLedger(),
      summary: summarizeLifecycleScorecardAnalytics()
    },
    operations: {
      board: createLifecycleScorecardOperationsBoard(),
      checklist: createLifecycleScorecardShiftChecklist(),
      incidents: createLifecycleScorecardIncidentDeck()
    },
    reporting: {
      cards: createLifecycleScorecardReportCards(),
      packets: createLifecycleScorecardReviewPackets(),
      summary: summarizeLifecycleScorecardReporting()
    },
    audit: {
      trail: createLifecycleScorecardAuditTrail(),
      manifest: createLifecycleScorecardEvidenceManifest(),
      attestation: createLifecycleScorecardReadinessAttestation()
    },
    playbooks: createLifecycleScorecardPlaybooks(),
    decisions: createLifecycleScorecardDecisionDeck(),
    escalationMoments: createLifecycleScorecardEscalationMoments()
  };
}

export function createLifecycleScorecardReadinessBoard(snapshot = buildLifecycleScorecardSnapshot()) {
  return [
    { id: 'lifecycle-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleScorecardApiDocument(snapshot = buildLifecycleScorecardSnapshot()) {
  return {
    id: 'lifecycle-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-scorecard/overview' },
      { method: 'GET', path: '/api/lifecycle-scorecard/reporting' },
      { method: 'POST', path: '/api/lifecycle-scorecard/validate' },
      { method: 'GET', path: '/api/lifecycle-scorecard/audit' }
    ],
    readiness: createLifecycleScorecardReadinessBoard(snapshot)
  };
}

export function createLifecycleScorecardRouteSummary(snapshot = buildLifecycleScorecardSnapshot()) {
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

