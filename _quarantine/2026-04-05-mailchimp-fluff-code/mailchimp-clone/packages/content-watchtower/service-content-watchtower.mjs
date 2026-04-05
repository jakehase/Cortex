import { createContentWatchtowerWorkspace, summarizeContentWatchtowerWorkspace, createContentWatchtowerNarratives, createContentWatchtowerCoverageGrid } from './domain-content-watchtower.mjs';
import { createContentWatchtowerPolicies, validateContentWatchtowerPolicies, summarizeContentWatchtowerPolicies, createContentWatchtowerEscalationDeck } from './policies-content-watchtower.mjs';
import { createContentWatchtowerAnalyticsTimeline, createContentWatchtowerForecastEnvelope, createContentWatchtowerExceptionLedger, summarizeContentWatchtowerAnalytics } from './analytics-content-watchtower.mjs';
import { createContentWatchtowerOperationsBoard, createContentWatchtowerShiftChecklist, createContentWatchtowerIncidentDeck } from './operations-content-watchtower.mjs';
import { createContentWatchtowerReportCards, createContentWatchtowerReviewPackets, summarizeContentWatchtowerReporting } from './reporting-content-watchtower.mjs';
import { createContentWatchtowerAuditTrail, createContentWatchtowerEvidenceManifest, createContentWatchtowerReadinessAttestation } from './audit-content-watchtower.mjs';
import { createContentWatchtowerPlaybooks, createContentWatchtowerDecisionDeck, createContentWatchtowerEscalationMoments } from './playbooks-content-watchtower.mjs';

export function buildContentWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentWatchtowerWorkspace(workspaceName);
  const policies = createContentWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeContentWatchtowerWorkspace(workspace),
    narratives: createContentWatchtowerNarratives(workspace),
    coverage: createContentWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentWatchtowerPolicies(policies),
    validation: validateContentWatchtowerPolicies(policies),
    escalationDeck: createContentWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createContentWatchtowerAnalyticsTimeline(),
      forecast: createContentWatchtowerForecastEnvelope(),
      exceptions: createContentWatchtowerExceptionLedger(),
      summary: summarizeContentWatchtowerAnalytics()
    },
    operations: {
      board: createContentWatchtowerOperationsBoard(),
      checklist: createContentWatchtowerShiftChecklist(),
      incidents: createContentWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createContentWatchtowerReportCards(),
      packets: createContentWatchtowerReviewPackets(),
      summary: summarizeContentWatchtowerReporting()
    },
    audit: {
      trail: createContentWatchtowerAuditTrail(),
      manifest: createContentWatchtowerEvidenceManifest(),
      attestation: createContentWatchtowerReadinessAttestation()
    },
    playbooks: createContentWatchtowerPlaybooks(),
    decisions: createContentWatchtowerDecisionDeck(),
    escalationMoments: createContentWatchtowerEscalationMoments()
  };
}

export function createContentWatchtowerReadinessBoard(snapshot = buildContentWatchtowerSnapshot()) {
  return [
    { id: 'content-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentWatchtowerApiDocument(snapshot = buildContentWatchtowerSnapshot()) {
  return {
    id: 'content-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-watchtower/overview' },
      { method: 'GET', path: '/api/content-watchtower/reporting' },
      { method: 'POST', path: '/api/content-watchtower/validate' },
      { method: 'GET', path: '/api/content-watchtower/audit' }
    ],
    readiness: createContentWatchtowerReadinessBoard(snapshot)
  };
}

export function createContentWatchtowerRouteSummary(snapshot = buildContentWatchtowerSnapshot()) {
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

