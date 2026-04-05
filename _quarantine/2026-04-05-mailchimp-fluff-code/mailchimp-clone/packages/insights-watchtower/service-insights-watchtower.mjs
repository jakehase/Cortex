import { createInsightsWatchtowerWorkspace, summarizeInsightsWatchtowerWorkspace, createInsightsWatchtowerNarratives, createInsightsWatchtowerCoverageGrid } from './domain-insights-watchtower.mjs';
import { createInsightsWatchtowerPolicies, validateInsightsWatchtowerPolicies, summarizeInsightsWatchtowerPolicies, createInsightsWatchtowerEscalationDeck } from './policies-insights-watchtower.mjs';
import { createInsightsWatchtowerAnalyticsTimeline, createInsightsWatchtowerForecastEnvelope, createInsightsWatchtowerExceptionLedger, summarizeInsightsWatchtowerAnalytics } from './analytics-insights-watchtower.mjs';
import { createInsightsWatchtowerOperationsBoard, createInsightsWatchtowerShiftChecklist, createInsightsWatchtowerIncidentDeck } from './operations-insights-watchtower.mjs';
import { createInsightsWatchtowerReportCards, createInsightsWatchtowerReviewPackets, summarizeInsightsWatchtowerReporting } from './reporting-insights-watchtower.mjs';
import { createInsightsWatchtowerAuditTrail, createInsightsWatchtowerEvidenceManifest, createInsightsWatchtowerReadinessAttestation } from './audit-insights-watchtower.mjs';
import { createInsightsWatchtowerPlaybooks, createInsightsWatchtowerDecisionDeck, createInsightsWatchtowerEscalationMoments } from './playbooks-insights-watchtower.mjs';

export function buildInsightsWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsWatchtowerWorkspace(workspaceName);
  const policies = createInsightsWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeInsightsWatchtowerWorkspace(workspace),
    narratives: createInsightsWatchtowerNarratives(workspace),
    coverage: createInsightsWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsWatchtowerPolicies(policies),
    validation: validateInsightsWatchtowerPolicies(policies),
    escalationDeck: createInsightsWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createInsightsWatchtowerAnalyticsTimeline(),
      forecast: createInsightsWatchtowerForecastEnvelope(),
      exceptions: createInsightsWatchtowerExceptionLedger(),
      summary: summarizeInsightsWatchtowerAnalytics()
    },
    operations: {
      board: createInsightsWatchtowerOperationsBoard(),
      checklist: createInsightsWatchtowerShiftChecklist(),
      incidents: createInsightsWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createInsightsWatchtowerReportCards(),
      packets: createInsightsWatchtowerReviewPackets(),
      summary: summarizeInsightsWatchtowerReporting()
    },
    audit: {
      trail: createInsightsWatchtowerAuditTrail(),
      manifest: createInsightsWatchtowerEvidenceManifest(),
      attestation: createInsightsWatchtowerReadinessAttestation()
    },
    playbooks: createInsightsWatchtowerPlaybooks(),
    decisions: createInsightsWatchtowerDecisionDeck(),
    escalationMoments: createInsightsWatchtowerEscalationMoments()
  };
}

export function createInsightsWatchtowerReadinessBoard(snapshot = buildInsightsWatchtowerSnapshot()) {
  return [
    { id: 'insights-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsWatchtowerApiDocument(snapshot = buildInsightsWatchtowerSnapshot()) {
  return {
    id: 'insights-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-watchtower/overview' },
      { method: 'GET', path: '/api/insights-watchtower/reporting' },
      { method: 'POST', path: '/api/insights-watchtower/validate' },
      { method: 'GET', path: '/api/insights-watchtower/audit' }
    ],
    readiness: createInsightsWatchtowerReadinessBoard(snapshot)
  };
}

export function createInsightsWatchtowerRouteSummary(snapshot = buildInsightsWatchtowerSnapshot()) {
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

