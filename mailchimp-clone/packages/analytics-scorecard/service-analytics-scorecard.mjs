import { createAnalyticsScorecardWorkspace, summarizeAnalyticsScorecardWorkspace, createAnalyticsScorecardNarratives, createAnalyticsScorecardCoverageGrid } from './domain-analytics-scorecard.mjs';
import { createAnalyticsScorecardPolicies, validateAnalyticsScorecardPolicies, summarizeAnalyticsScorecardPolicies, createAnalyticsScorecardEscalationDeck } from './policies-analytics-scorecard.mjs';
import { createAnalyticsScorecardAnalyticsTimeline, createAnalyticsScorecardForecastEnvelope, createAnalyticsScorecardExceptionLedger, summarizeAnalyticsScorecardAnalytics } from './analytics-analytics-scorecard.mjs';
import { createAnalyticsScorecardOperationsBoard, createAnalyticsScorecardShiftChecklist, createAnalyticsScorecardIncidentDeck } from './operations-analytics-scorecard.mjs';
import { createAnalyticsScorecardReportCards, createAnalyticsScorecardReviewPackets, summarizeAnalyticsScorecardReporting } from './reporting-analytics-scorecard.mjs';
import { createAnalyticsScorecardAuditTrail, createAnalyticsScorecardEvidenceManifest, createAnalyticsScorecardReadinessAttestation } from './audit-analytics-scorecard.mjs';
import { createAnalyticsScorecardPlaybooks, createAnalyticsScorecardDecisionDeck, createAnalyticsScorecardEscalationMoments } from './playbooks-analytics-scorecard.mjs';

export function buildAnalyticsScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsScorecardWorkspace(workspaceName);
  const policies = createAnalyticsScorecardPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsScorecardWorkspace(workspace),
    narratives: createAnalyticsScorecardNarratives(workspace),
    coverage: createAnalyticsScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsScorecardPolicies(policies),
    validation: validateAnalyticsScorecardPolicies(policies),
    escalationDeck: createAnalyticsScorecardEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsScorecardAnalyticsTimeline(),
      forecast: createAnalyticsScorecardForecastEnvelope(),
      exceptions: createAnalyticsScorecardExceptionLedger(),
      summary: summarizeAnalyticsScorecardAnalytics()
    },
    operations: {
      board: createAnalyticsScorecardOperationsBoard(),
      checklist: createAnalyticsScorecardShiftChecklist(),
      incidents: createAnalyticsScorecardIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsScorecardReportCards(),
      packets: createAnalyticsScorecardReviewPackets(),
      summary: summarizeAnalyticsScorecardReporting()
    },
    audit: {
      trail: createAnalyticsScorecardAuditTrail(),
      manifest: createAnalyticsScorecardEvidenceManifest(),
      attestation: createAnalyticsScorecardReadinessAttestation()
    },
    playbooks: createAnalyticsScorecardPlaybooks(),
    decisions: createAnalyticsScorecardDecisionDeck(),
    escalationMoments: createAnalyticsScorecardEscalationMoments()
  };
}

export function createAnalyticsScorecardReadinessBoard(snapshot = buildAnalyticsScorecardSnapshot()) {
  return [
    { id: 'analytics-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsScorecardApiDocument(snapshot = buildAnalyticsScorecardSnapshot()) {
  return {
    id: 'analytics-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-scorecard/overview' },
      { method: 'GET', path: '/api/analytics-scorecard/reporting' },
      { method: 'POST', path: '/api/analytics-scorecard/validate' },
      { method: 'GET', path: '/api/analytics-scorecard/audit' }
    ],
    readiness: createAnalyticsScorecardReadinessBoard(snapshot)
  };
}

export function createAnalyticsScorecardRouteSummary(snapshot = buildAnalyticsScorecardSnapshot()) {
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

