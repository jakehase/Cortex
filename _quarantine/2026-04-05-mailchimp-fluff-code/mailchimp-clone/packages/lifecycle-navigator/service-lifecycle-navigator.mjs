import { createLifecycleNavigatorWorkspace, summarizeLifecycleNavigatorWorkspace, createLifecycleNavigatorNarratives, createLifecycleNavigatorCoverageGrid } from './domain-lifecycle-navigator.mjs';
import { createLifecycleNavigatorPolicies, validateLifecycleNavigatorPolicies, summarizeLifecycleNavigatorPolicies, createLifecycleNavigatorEscalationDeck } from './policies-lifecycle-navigator.mjs';
import { createLifecycleNavigatorAnalyticsTimeline, createLifecycleNavigatorForecastEnvelope, createLifecycleNavigatorExceptionLedger, summarizeLifecycleNavigatorAnalytics } from './analytics-lifecycle-navigator.mjs';
import { createLifecycleNavigatorOperationsBoard, createLifecycleNavigatorShiftChecklist, createLifecycleNavigatorIncidentDeck } from './operations-lifecycle-navigator.mjs';
import { createLifecycleNavigatorReportCards, createLifecycleNavigatorReviewPackets, summarizeLifecycleNavigatorReporting } from './reporting-lifecycle-navigator.mjs';
import { createLifecycleNavigatorAuditTrail, createLifecycleNavigatorEvidenceManifest, createLifecycleNavigatorReadinessAttestation } from './audit-lifecycle-navigator.mjs';
import { createLifecycleNavigatorPlaybooks, createLifecycleNavigatorDecisionDeck, createLifecycleNavigatorEscalationMoments } from './playbooks-lifecycle-navigator.mjs';

export function buildLifecycleNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleNavigatorWorkspace(workspaceName);
  const policies = createLifecycleNavigatorPolicies();
  return {
    workspace,
    summary: summarizeLifecycleNavigatorWorkspace(workspace),
    narratives: createLifecycleNavigatorNarratives(workspace),
    coverage: createLifecycleNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleNavigatorPolicies(policies),
    validation: validateLifecycleNavigatorPolicies(policies),
    escalationDeck: createLifecycleNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleNavigatorAnalyticsTimeline(),
      forecast: createLifecycleNavigatorForecastEnvelope(),
      exceptions: createLifecycleNavigatorExceptionLedger(),
      summary: summarizeLifecycleNavigatorAnalytics()
    },
    operations: {
      board: createLifecycleNavigatorOperationsBoard(),
      checklist: createLifecycleNavigatorShiftChecklist(),
      incidents: createLifecycleNavigatorIncidentDeck()
    },
    reporting: {
      cards: createLifecycleNavigatorReportCards(),
      packets: createLifecycleNavigatorReviewPackets(),
      summary: summarizeLifecycleNavigatorReporting()
    },
    audit: {
      trail: createLifecycleNavigatorAuditTrail(),
      manifest: createLifecycleNavigatorEvidenceManifest(),
      attestation: createLifecycleNavigatorReadinessAttestation()
    },
    playbooks: createLifecycleNavigatorPlaybooks(),
    decisions: createLifecycleNavigatorDecisionDeck(),
    escalationMoments: createLifecycleNavigatorEscalationMoments()
  };
}

export function createLifecycleNavigatorReadinessBoard(snapshot = buildLifecycleNavigatorSnapshot()) {
  return [
    { id: 'lifecycle-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleNavigatorApiDocument(snapshot = buildLifecycleNavigatorSnapshot()) {
  return {
    id: 'lifecycle-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-navigator/overview' },
      { method: 'GET', path: '/api/lifecycle-navigator/reporting' },
      { method: 'POST', path: '/api/lifecycle-navigator/validate' },
      { method: 'GET', path: '/api/lifecycle-navigator/audit' }
    ],
    readiness: createLifecycleNavigatorReadinessBoard(snapshot)
  };
}

export function createLifecycleNavigatorRouteSummary(snapshot = buildLifecycleNavigatorSnapshot()) {
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

