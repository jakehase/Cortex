import { createDataWatchtowerWorkspace, summarizeDataWatchtowerWorkspace, createDataWatchtowerNarratives, createDataWatchtowerCoverageGrid } from './domain-data-watchtower.mjs';
import { createDataWatchtowerPolicies, validateDataWatchtowerPolicies, summarizeDataWatchtowerPolicies, createDataWatchtowerEscalationDeck } from './policies-data-watchtower.mjs';
import { createDataWatchtowerAnalyticsTimeline, createDataWatchtowerForecastEnvelope, createDataWatchtowerExceptionLedger, summarizeDataWatchtowerAnalytics } from './analytics-data-watchtower.mjs';
import { createDataWatchtowerOperationsBoard, createDataWatchtowerShiftChecklist, createDataWatchtowerIncidentDeck } from './operations-data-watchtower.mjs';
import { createDataWatchtowerReportCards, createDataWatchtowerReviewPackets, summarizeDataWatchtowerReporting } from './reporting-data-watchtower.mjs';
import { createDataWatchtowerAuditTrail, createDataWatchtowerEvidenceManifest, createDataWatchtowerReadinessAttestation } from './audit-data-watchtower.mjs';
import { createDataWatchtowerPlaybooks, createDataWatchtowerDecisionDeck, createDataWatchtowerEscalationMoments } from './playbooks-data-watchtower.mjs';

export function buildDataWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataWatchtowerWorkspace(workspaceName);
  const policies = createDataWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeDataWatchtowerWorkspace(workspace),
    narratives: createDataWatchtowerNarratives(workspace),
    coverage: createDataWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataWatchtowerPolicies(policies),
    validation: validateDataWatchtowerPolicies(policies),
    escalationDeck: createDataWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createDataWatchtowerAnalyticsTimeline(),
      forecast: createDataWatchtowerForecastEnvelope(),
      exceptions: createDataWatchtowerExceptionLedger(),
      summary: summarizeDataWatchtowerAnalytics()
    },
    operations: {
      board: createDataWatchtowerOperationsBoard(),
      checklist: createDataWatchtowerShiftChecklist(),
      incidents: createDataWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createDataWatchtowerReportCards(),
      packets: createDataWatchtowerReviewPackets(),
      summary: summarizeDataWatchtowerReporting()
    },
    audit: {
      trail: createDataWatchtowerAuditTrail(),
      manifest: createDataWatchtowerEvidenceManifest(),
      attestation: createDataWatchtowerReadinessAttestation()
    },
    playbooks: createDataWatchtowerPlaybooks(),
    decisions: createDataWatchtowerDecisionDeck(),
    escalationMoments: createDataWatchtowerEscalationMoments()
  };
}

export function createDataWatchtowerReadinessBoard(snapshot = buildDataWatchtowerSnapshot()) {
  return [
    { id: 'data-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataWatchtowerApiDocument(snapshot = buildDataWatchtowerSnapshot()) {
  return {
    id: 'data-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-watchtower/overview' },
      { method: 'GET', path: '/api/data-watchtower/reporting' },
      { method: 'POST', path: '/api/data-watchtower/validate' },
      { method: 'GET', path: '/api/data-watchtower/audit' }
    ],
    readiness: createDataWatchtowerReadinessBoard(snapshot)
  };
}

export function createDataWatchtowerRouteSummary(snapshot = buildDataWatchtowerSnapshot()) {
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

