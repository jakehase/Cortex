import { createActivationWatchtowerWorkspace, summarizeActivationWatchtowerWorkspace, createActivationWatchtowerNarratives, createActivationWatchtowerCoverageGrid } from './domain-activation-watchtower.mjs';
import { createActivationWatchtowerPolicies, validateActivationWatchtowerPolicies, summarizeActivationWatchtowerPolicies, createActivationWatchtowerEscalationDeck } from './policies-activation-watchtower.mjs';
import { createActivationWatchtowerAnalyticsTimeline, createActivationWatchtowerForecastEnvelope, createActivationWatchtowerExceptionLedger, summarizeActivationWatchtowerAnalytics } from './analytics-activation-watchtower.mjs';
import { createActivationWatchtowerOperationsBoard, createActivationWatchtowerShiftChecklist, createActivationWatchtowerIncidentDeck } from './operations-activation-watchtower.mjs';
import { createActivationWatchtowerReportCards, createActivationWatchtowerReviewPackets, summarizeActivationWatchtowerReporting } from './reporting-activation-watchtower.mjs';
import { createActivationWatchtowerAuditTrail, createActivationWatchtowerEvidenceManifest, createActivationWatchtowerReadinessAttestation } from './audit-activation-watchtower.mjs';
import { createActivationWatchtowerPlaybooks, createActivationWatchtowerDecisionDeck, createActivationWatchtowerEscalationMoments } from './playbooks-activation-watchtower.mjs';

export function buildActivationWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationWatchtowerWorkspace(workspaceName);
  const policies = createActivationWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeActivationWatchtowerWorkspace(workspace),
    narratives: createActivationWatchtowerNarratives(workspace),
    coverage: createActivationWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationWatchtowerPolicies(policies),
    validation: validateActivationWatchtowerPolicies(policies),
    escalationDeck: createActivationWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createActivationWatchtowerAnalyticsTimeline(),
      forecast: createActivationWatchtowerForecastEnvelope(),
      exceptions: createActivationWatchtowerExceptionLedger(),
      summary: summarizeActivationWatchtowerAnalytics()
    },
    operations: {
      board: createActivationWatchtowerOperationsBoard(),
      checklist: createActivationWatchtowerShiftChecklist(),
      incidents: createActivationWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createActivationWatchtowerReportCards(),
      packets: createActivationWatchtowerReviewPackets(),
      summary: summarizeActivationWatchtowerReporting()
    },
    audit: {
      trail: createActivationWatchtowerAuditTrail(),
      manifest: createActivationWatchtowerEvidenceManifest(),
      attestation: createActivationWatchtowerReadinessAttestation()
    },
    playbooks: createActivationWatchtowerPlaybooks(),
    decisions: createActivationWatchtowerDecisionDeck(),
    escalationMoments: createActivationWatchtowerEscalationMoments()
  };
}

export function createActivationWatchtowerReadinessBoard(snapshot = buildActivationWatchtowerSnapshot()) {
  return [
    { id: 'activation-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationWatchtowerApiDocument(snapshot = buildActivationWatchtowerSnapshot()) {
  return {
    id: 'activation-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-watchtower/overview' },
      { method: 'GET', path: '/api/activation-watchtower/reporting' },
      { method: 'POST', path: '/api/activation-watchtower/validate' },
      { method: 'GET', path: '/api/activation-watchtower/audit' }
    ],
    readiness: createActivationWatchtowerReadinessBoard(snapshot)
  };
}

export function createActivationWatchtowerRouteSummary(snapshot = buildActivationWatchtowerSnapshot()) {
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

