import { createLifecycleWorkbenchWorkspace, summarizeLifecycleWorkbenchWorkspace, createLifecycleWorkbenchNarratives, createLifecycleWorkbenchCoverageGrid } from './domain-lifecycle-workbench.mjs';
import { createLifecycleWorkbenchPolicies, validateLifecycleWorkbenchPolicies, summarizeLifecycleWorkbenchPolicies, createLifecycleWorkbenchEscalationDeck } from './policies-lifecycle-workbench.mjs';
import { createLifecycleWorkbenchAnalyticsTimeline, createLifecycleWorkbenchForecastEnvelope, createLifecycleWorkbenchExceptionLedger, summarizeLifecycleWorkbenchAnalytics } from './analytics-lifecycle-workbench.mjs';
import { createLifecycleWorkbenchOperationsBoard, createLifecycleWorkbenchShiftChecklist, createLifecycleWorkbenchIncidentDeck } from './operations-lifecycle-workbench.mjs';
import { createLifecycleWorkbenchReportCards, createLifecycleWorkbenchReviewPackets, summarizeLifecycleWorkbenchReporting } from './reporting-lifecycle-workbench.mjs';
import { createLifecycleWorkbenchAuditTrail, createLifecycleWorkbenchEvidenceManifest, createLifecycleWorkbenchReadinessAttestation } from './audit-lifecycle-workbench.mjs';
import { createLifecycleWorkbenchPlaybooks, createLifecycleWorkbenchDecisionDeck, createLifecycleWorkbenchEscalationMoments } from './playbooks-lifecycle-workbench.mjs';

export function buildLifecycleWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleWorkbenchWorkspace(workspaceName);
  const policies = createLifecycleWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeLifecycleWorkbenchWorkspace(workspace),
    narratives: createLifecycleWorkbenchNarratives(workspace),
    coverage: createLifecycleWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleWorkbenchPolicies(policies),
    validation: validateLifecycleWorkbenchPolicies(policies),
    escalationDeck: createLifecycleWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleWorkbenchAnalyticsTimeline(),
      forecast: createLifecycleWorkbenchForecastEnvelope(),
      exceptions: createLifecycleWorkbenchExceptionLedger(),
      summary: summarizeLifecycleWorkbenchAnalytics()
    },
    operations: {
      board: createLifecycleWorkbenchOperationsBoard(),
      checklist: createLifecycleWorkbenchShiftChecklist(),
      incidents: createLifecycleWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createLifecycleWorkbenchReportCards(),
      packets: createLifecycleWorkbenchReviewPackets(),
      summary: summarizeLifecycleWorkbenchReporting()
    },
    audit: {
      trail: createLifecycleWorkbenchAuditTrail(),
      manifest: createLifecycleWorkbenchEvidenceManifest(),
      attestation: createLifecycleWorkbenchReadinessAttestation()
    },
    playbooks: createLifecycleWorkbenchPlaybooks(),
    decisions: createLifecycleWorkbenchDecisionDeck(),
    escalationMoments: createLifecycleWorkbenchEscalationMoments()
  };
}

export function createLifecycleWorkbenchReadinessBoard(snapshot = buildLifecycleWorkbenchSnapshot()) {
  return [
    { id: 'lifecycle-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleWorkbenchApiDocument(snapshot = buildLifecycleWorkbenchSnapshot()) {
  return {
    id: 'lifecycle-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-workbench/overview' },
      { method: 'GET', path: '/api/lifecycle-workbench/reporting' },
      { method: 'POST', path: '/api/lifecycle-workbench/validate' },
      { method: 'GET', path: '/api/lifecycle-workbench/audit' }
    ],
    readiness: createLifecycleWorkbenchReadinessBoard(snapshot)
  };
}

export function createLifecycleWorkbenchRouteSummary(snapshot = buildLifecycleWorkbenchSnapshot()) {
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

