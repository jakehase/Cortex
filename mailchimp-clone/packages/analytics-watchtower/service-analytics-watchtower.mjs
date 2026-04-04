import { createAnalyticsWatchtowerWorkspace, summarizeAnalyticsWatchtowerWorkspace, createAnalyticsWatchtowerNarratives, createAnalyticsWatchtowerCoverageGrid } from './domain-analytics-watchtower.mjs';
import { createAnalyticsWatchtowerPolicies, validateAnalyticsWatchtowerPolicies, summarizeAnalyticsWatchtowerPolicies, createAnalyticsWatchtowerEscalationDeck } from './policies-analytics-watchtower.mjs';
import { createAnalyticsWatchtowerAnalyticsTimeline, createAnalyticsWatchtowerForecastEnvelope, createAnalyticsWatchtowerExceptionLedger, summarizeAnalyticsWatchtowerAnalytics } from './analytics-analytics-watchtower.mjs';
import { createAnalyticsWatchtowerOperationsBoard, createAnalyticsWatchtowerShiftChecklist, createAnalyticsWatchtowerIncidentDeck } from './operations-analytics-watchtower.mjs';
import { createAnalyticsWatchtowerReportCards, createAnalyticsWatchtowerReviewPackets, summarizeAnalyticsWatchtowerReporting } from './reporting-analytics-watchtower.mjs';
import { createAnalyticsWatchtowerAuditTrail, createAnalyticsWatchtowerEvidenceManifest, createAnalyticsWatchtowerReadinessAttestation } from './audit-analytics-watchtower.mjs';
import { createAnalyticsWatchtowerPlaybooks, createAnalyticsWatchtowerDecisionDeck, createAnalyticsWatchtowerEscalationMoments } from './playbooks-analytics-watchtower.mjs';

export function buildAnalyticsWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsWatchtowerWorkspace(workspaceName);
  const policies = createAnalyticsWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsWatchtowerWorkspace(workspace),
    narratives: createAnalyticsWatchtowerNarratives(workspace),
    coverage: createAnalyticsWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsWatchtowerPolicies(policies),
    validation: validateAnalyticsWatchtowerPolicies(policies),
    escalationDeck: createAnalyticsWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsWatchtowerAnalyticsTimeline(),
      forecast: createAnalyticsWatchtowerForecastEnvelope(),
      exceptions: createAnalyticsWatchtowerExceptionLedger(),
      summary: summarizeAnalyticsWatchtowerAnalytics()
    },
    operations: {
      board: createAnalyticsWatchtowerOperationsBoard(),
      checklist: createAnalyticsWatchtowerShiftChecklist(),
      incidents: createAnalyticsWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsWatchtowerReportCards(),
      packets: createAnalyticsWatchtowerReviewPackets(),
      summary: summarizeAnalyticsWatchtowerReporting()
    },
    audit: {
      trail: createAnalyticsWatchtowerAuditTrail(),
      manifest: createAnalyticsWatchtowerEvidenceManifest(),
      attestation: createAnalyticsWatchtowerReadinessAttestation()
    },
    playbooks: createAnalyticsWatchtowerPlaybooks(),
    decisions: createAnalyticsWatchtowerDecisionDeck(),
    escalationMoments: createAnalyticsWatchtowerEscalationMoments()
  };
}

export function createAnalyticsWatchtowerReadinessBoard(snapshot = buildAnalyticsWatchtowerSnapshot()) {
  return [
    { id: 'analytics-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsWatchtowerApiDocument(snapshot = buildAnalyticsWatchtowerSnapshot()) {
  return {
    id: 'analytics-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-watchtower/overview' },
      { method: 'GET', path: '/api/analytics-watchtower/reporting' },
      { method: 'POST', path: '/api/analytics-watchtower/validate' },
      { method: 'GET', path: '/api/analytics-watchtower/audit' }
    ],
    readiness: createAnalyticsWatchtowerReadinessBoard(snapshot)
  };
}

export function createAnalyticsWatchtowerRouteSummary(snapshot = buildAnalyticsWatchtowerSnapshot()) {
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

