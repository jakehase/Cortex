import { createInsightsScorecardWorkspace, summarizeInsightsScorecardWorkspace, createInsightsScorecardNarratives, createInsightsScorecardCoverageGrid } from './domain-insights-scorecard.mjs';
import { createInsightsScorecardPolicies, validateInsightsScorecardPolicies, summarizeInsightsScorecardPolicies, createInsightsScorecardEscalationDeck } from './policies-insights-scorecard.mjs';
import { createInsightsScorecardAnalyticsTimeline, createInsightsScorecardForecastEnvelope, createInsightsScorecardExceptionLedger, summarizeInsightsScorecardAnalytics } from './analytics-insights-scorecard.mjs';
import { createInsightsScorecardOperationsBoard, createInsightsScorecardShiftChecklist, createInsightsScorecardIncidentDeck } from './operations-insights-scorecard.mjs';
import { createInsightsScorecardReportCards, createInsightsScorecardReviewPackets, summarizeInsightsScorecardReporting } from './reporting-insights-scorecard.mjs';
import { createInsightsScorecardAuditTrail, createInsightsScorecardEvidenceManifest, createInsightsScorecardReadinessAttestation } from './audit-insights-scorecard.mjs';
import { createInsightsScorecardPlaybooks, createInsightsScorecardDecisionDeck, createInsightsScorecardEscalationMoments } from './playbooks-insights-scorecard.mjs';

export function buildInsightsScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsScorecardWorkspace(workspaceName);
  const policies = createInsightsScorecardPolicies();
  return {
    workspace,
    summary: summarizeInsightsScorecardWorkspace(workspace),
    narratives: createInsightsScorecardNarratives(workspace),
    coverage: createInsightsScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsScorecardPolicies(policies),
    validation: validateInsightsScorecardPolicies(policies),
    escalationDeck: createInsightsScorecardEscalationDeck(policies),
    analytics: {
      timeline: createInsightsScorecardAnalyticsTimeline(),
      forecast: createInsightsScorecardForecastEnvelope(),
      exceptions: createInsightsScorecardExceptionLedger(),
      summary: summarizeInsightsScorecardAnalytics()
    },
    operations: {
      board: createInsightsScorecardOperationsBoard(),
      checklist: createInsightsScorecardShiftChecklist(),
      incidents: createInsightsScorecardIncidentDeck()
    },
    reporting: {
      cards: createInsightsScorecardReportCards(),
      packets: createInsightsScorecardReviewPackets(),
      summary: summarizeInsightsScorecardReporting()
    },
    audit: {
      trail: createInsightsScorecardAuditTrail(),
      manifest: createInsightsScorecardEvidenceManifest(),
      attestation: createInsightsScorecardReadinessAttestation()
    },
    playbooks: createInsightsScorecardPlaybooks(),
    decisions: createInsightsScorecardDecisionDeck(),
    escalationMoments: createInsightsScorecardEscalationMoments()
  };
}

export function createInsightsScorecardReadinessBoard(snapshot = buildInsightsScorecardSnapshot()) {
  return [
    { id: 'insights-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsScorecardApiDocument(snapshot = buildInsightsScorecardSnapshot()) {
  return {
    id: 'insights-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-scorecard/overview' },
      { method: 'GET', path: '/api/insights-scorecard/reporting' },
      { method: 'POST', path: '/api/insights-scorecard/validate' },
      { method: 'GET', path: '/api/insights-scorecard/audit' }
    ],
    readiness: createInsightsScorecardReadinessBoard(snapshot)
  };
}

export function createInsightsScorecardRouteSummary(snapshot = buildInsightsScorecardSnapshot()) {
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

