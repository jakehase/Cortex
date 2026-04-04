import { createLifecycleHubWorkspace, summarizeLifecycleHubWorkspace, createLifecycleHubNarratives, createLifecycleHubCoverageGrid } from './domain-lifecycle-hub.mjs';
import { createLifecycleHubPolicies, validateLifecycleHubPolicies, summarizeLifecycleHubPolicies, createLifecycleHubEscalationDeck } from './policies-lifecycle-hub.mjs';
import { createLifecycleHubAnalyticsTimeline, createLifecycleHubForecastEnvelope, createLifecycleHubExceptionLedger, summarizeLifecycleHubAnalytics } from './analytics-lifecycle-hub.mjs';
import { createLifecycleHubOperationsBoard, createLifecycleHubShiftChecklist, createLifecycleHubIncidentDeck } from './operations-lifecycle-hub.mjs';
import { createLifecycleHubReportCards, createLifecycleHubReviewPackets, summarizeLifecycleHubReporting } from './reporting-lifecycle-hub.mjs';
import { createLifecycleHubAuditTrail, createLifecycleHubEvidenceManifest, createLifecycleHubReadinessAttestation } from './audit-lifecycle-hub.mjs';
import { createLifecycleHubPlaybooks, createLifecycleHubDecisionDeck, createLifecycleHubEscalationMoments } from './playbooks-lifecycle-hub.mjs';

export function buildLifecycleHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleHubWorkspace(workspaceName);
  const policies = createLifecycleHubPolicies();
  return {
    workspace,
    summary: summarizeLifecycleHubWorkspace(workspace),
    narratives: createLifecycleHubNarratives(workspace),
    coverage: createLifecycleHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleHubPolicies(policies),
    validation: validateLifecycleHubPolicies(policies),
    escalationDeck: createLifecycleHubEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleHubAnalyticsTimeline(),
      forecast: createLifecycleHubForecastEnvelope(),
      exceptions: createLifecycleHubExceptionLedger(),
      summary: summarizeLifecycleHubAnalytics()
    },
    operations: {
      board: createLifecycleHubOperationsBoard(),
      checklist: createLifecycleHubShiftChecklist(),
      incidents: createLifecycleHubIncidentDeck()
    },
    reporting: {
      cards: createLifecycleHubReportCards(),
      packets: createLifecycleHubReviewPackets(),
      summary: summarizeLifecycleHubReporting()
    },
    audit: {
      trail: createLifecycleHubAuditTrail(),
      manifest: createLifecycleHubEvidenceManifest(),
      attestation: createLifecycleHubReadinessAttestation()
    },
    playbooks: createLifecycleHubPlaybooks(),
    decisions: createLifecycleHubDecisionDeck(),
    escalationMoments: createLifecycleHubEscalationMoments()
  };
}

export function createLifecycleHubReadinessBoard(snapshot = buildLifecycleHubSnapshot()) {
  return [
    { id: 'lifecycle-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleHubApiDocument(snapshot = buildLifecycleHubSnapshot()) {
  return {
    id: 'lifecycle-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-hub/overview' },
      { method: 'GET', path: '/api/lifecycle-hub/reporting' },
      { method: 'POST', path: '/api/lifecycle-hub/validate' },
      { method: 'GET', path: '/api/lifecycle-hub/audit' }
    ],
    readiness: createLifecycleHubReadinessBoard(snapshot)
  };
}

export function createLifecycleHubRouteSummary(snapshot = buildLifecycleHubSnapshot()) {
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

