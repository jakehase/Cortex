import { createLifecycleStudioWorkspace, summarizeLifecycleStudioWorkspace, createLifecycleStudioNarratives, createLifecycleStudioCoverageGrid } from './domain-lifecycle-studio.mjs';
import { createLifecycleStudioPolicies, validateLifecycleStudioPolicies, summarizeLifecycleStudioPolicies, createLifecycleStudioEscalationDeck } from './policies-lifecycle-studio.mjs';
import { createLifecycleStudioAnalyticsTimeline, createLifecycleStudioForecastEnvelope, createLifecycleStudioExceptionLedger, summarizeLifecycleStudioAnalytics } from './analytics-lifecycle-studio.mjs';
import { createLifecycleStudioOperationsBoard, createLifecycleStudioShiftChecklist, createLifecycleStudioIncidentDeck } from './operations-lifecycle-studio.mjs';
import { createLifecycleStudioReportCards, createLifecycleStudioReviewPackets, summarizeLifecycleStudioReporting } from './reporting-lifecycle-studio.mjs';
import { createLifecycleStudioAuditTrail, createLifecycleStudioEvidenceManifest, createLifecycleStudioReadinessAttestation } from './audit-lifecycle-studio.mjs';
import { createLifecycleStudioPlaybooks, createLifecycleStudioDecisionDeck, createLifecycleStudioEscalationMoments } from './playbooks-lifecycle-studio.mjs';

export function buildLifecycleStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleStudioWorkspace(workspaceName);
  const policies = createLifecycleStudioPolicies();
  return {
    workspace,
    summary: summarizeLifecycleStudioWorkspace(workspace),
    narratives: createLifecycleStudioNarratives(workspace),
    coverage: createLifecycleStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleStudioPolicies(policies),
    validation: validateLifecycleStudioPolicies(policies),
    escalationDeck: createLifecycleStudioEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleStudioAnalyticsTimeline(),
      forecast: createLifecycleStudioForecastEnvelope(),
      exceptions: createLifecycleStudioExceptionLedger(),
      summary: summarizeLifecycleStudioAnalytics()
    },
    operations: {
      board: createLifecycleStudioOperationsBoard(),
      checklist: createLifecycleStudioShiftChecklist(),
      incidents: createLifecycleStudioIncidentDeck()
    },
    reporting: {
      cards: createLifecycleStudioReportCards(),
      packets: createLifecycleStudioReviewPackets(),
      summary: summarizeLifecycleStudioReporting()
    },
    audit: {
      trail: createLifecycleStudioAuditTrail(),
      manifest: createLifecycleStudioEvidenceManifest(),
      attestation: createLifecycleStudioReadinessAttestation()
    },
    playbooks: createLifecycleStudioPlaybooks(),
    decisions: createLifecycleStudioDecisionDeck(),
    escalationMoments: createLifecycleStudioEscalationMoments()
  };
}

export function createLifecycleStudioReadinessBoard(snapshot = buildLifecycleStudioSnapshot()) {
  return [
    { id: 'lifecycle-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleStudioApiDocument(snapshot = buildLifecycleStudioSnapshot()) {
  return {
    id: 'lifecycle-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-studio/overview' },
      { method: 'GET', path: '/api/lifecycle-studio/reporting' },
      { method: 'POST', path: '/api/lifecycle-studio/validate' },
      { method: 'GET', path: '/api/lifecycle-studio/audit' }
    ],
    readiness: createLifecycleStudioReadinessBoard(snapshot)
  };
}

export function createLifecycleStudioRouteSummary(snapshot = buildLifecycleStudioSnapshot()) {
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

