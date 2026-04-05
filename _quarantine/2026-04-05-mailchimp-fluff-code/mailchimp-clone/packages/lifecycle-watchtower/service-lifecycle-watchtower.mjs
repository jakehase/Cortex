import { createLifecycleWatchtowerWorkspace, summarizeLifecycleWatchtowerWorkspace, createLifecycleWatchtowerNarratives, createLifecycleWatchtowerCoverageGrid } from './domain-lifecycle-watchtower.mjs';
import { createLifecycleWatchtowerPolicies, validateLifecycleWatchtowerPolicies, summarizeLifecycleWatchtowerPolicies, createLifecycleWatchtowerEscalationDeck } from './policies-lifecycle-watchtower.mjs';
import { createLifecycleWatchtowerAnalyticsTimeline, createLifecycleWatchtowerForecastEnvelope, createLifecycleWatchtowerExceptionLedger, summarizeLifecycleWatchtowerAnalytics } from './analytics-lifecycle-watchtower.mjs';
import { createLifecycleWatchtowerOperationsBoard, createLifecycleWatchtowerShiftChecklist, createLifecycleWatchtowerIncidentDeck } from './operations-lifecycle-watchtower.mjs';
import { createLifecycleWatchtowerReportCards, createLifecycleWatchtowerReviewPackets, summarizeLifecycleWatchtowerReporting } from './reporting-lifecycle-watchtower.mjs';
import { createLifecycleWatchtowerAuditTrail, createLifecycleWatchtowerEvidenceManifest, createLifecycleWatchtowerReadinessAttestation } from './audit-lifecycle-watchtower.mjs';
import { createLifecycleWatchtowerPlaybooks, createLifecycleWatchtowerDecisionDeck, createLifecycleWatchtowerEscalationMoments } from './playbooks-lifecycle-watchtower.mjs';

export function buildLifecycleWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleWatchtowerWorkspace(workspaceName);
  const policies = createLifecycleWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeLifecycleWatchtowerWorkspace(workspace),
    narratives: createLifecycleWatchtowerNarratives(workspace),
    coverage: createLifecycleWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleWatchtowerPolicies(policies),
    validation: validateLifecycleWatchtowerPolicies(policies),
    escalationDeck: createLifecycleWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleWatchtowerAnalyticsTimeline(),
      forecast: createLifecycleWatchtowerForecastEnvelope(),
      exceptions: createLifecycleWatchtowerExceptionLedger(),
      summary: summarizeLifecycleWatchtowerAnalytics()
    },
    operations: {
      board: createLifecycleWatchtowerOperationsBoard(),
      checklist: createLifecycleWatchtowerShiftChecklist(),
      incidents: createLifecycleWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createLifecycleWatchtowerReportCards(),
      packets: createLifecycleWatchtowerReviewPackets(),
      summary: summarizeLifecycleWatchtowerReporting()
    },
    audit: {
      trail: createLifecycleWatchtowerAuditTrail(),
      manifest: createLifecycleWatchtowerEvidenceManifest(),
      attestation: createLifecycleWatchtowerReadinessAttestation()
    },
    playbooks: createLifecycleWatchtowerPlaybooks(),
    decisions: createLifecycleWatchtowerDecisionDeck(),
    escalationMoments: createLifecycleWatchtowerEscalationMoments()
  };
}

export function createLifecycleWatchtowerReadinessBoard(snapshot = buildLifecycleWatchtowerSnapshot()) {
  return [
    { id: 'lifecycle-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleWatchtowerApiDocument(snapshot = buildLifecycleWatchtowerSnapshot()) {
  return {
    id: 'lifecycle-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-watchtower/overview' },
      { method: 'GET', path: '/api/lifecycle-watchtower/reporting' },
      { method: 'POST', path: '/api/lifecycle-watchtower/validate' },
      { method: 'GET', path: '/api/lifecycle-watchtower/audit' }
    ],
    readiness: createLifecycleWatchtowerReadinessBoard(snapshot)
  };
}

export function createLifecycleWatchtowerRouteSummary(snapshot = buildLifecycleWatchtowerSnapshot()) {
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

