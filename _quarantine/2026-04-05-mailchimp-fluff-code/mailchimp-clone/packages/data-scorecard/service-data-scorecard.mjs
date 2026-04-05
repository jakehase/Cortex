import { createDataScorecardWorkspace, summarizeDataScorecardWorkspace, createDataScorecardNarratives, createDataScorecardCoverageGrid } from './domain-data-scorecard.mjs';
import { createDataScorecardPolicies, validateDataScorecardPolicies, summarizeDataScorecardPolicies, createDataScorecardEscalationDeck } from './policies-data-scorecard.mjs';
import { createDataScorecardAnalyticsTimeline, createDataScorecardForecastEnvelope, createDataScorecardExceptionLedger, summarizeDataScorecardAnalytics } from './analytics-data-scorecard.mjs';
import { createDataScorecardOperationsBoard, createDataScorecardShiftChecklist, createDataScorecardIncidentDeck } from './operations-data-scorecard.mjs';
import { createDataScorecardReportCards, createDataScorecardReviewPackets, summarizeDataScorecardReporting } from './reporting-data-scorecard.mjs';
import { createDataScorecardAuditTrail, createDataScorecardEvidenceManifest, createDataScorecardReadinessAttestation } from './audit-data-scorecard.mjs';
import { createDataScorecardPlaybooks, createDataScorecardDecisionDeck, createDataScorecardEscalationMoments } from './playbooks-data-scorecard.mjs';

export function buildDataScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataScorecardWorkspace(workspaceName);
  const policies = createDataScorecardPolicies();
  return {
    workspace,
    summary: summarizeDataScorecardWorkspace(workspace),
    narratives: createDataScorecardNarratives(workspace),
    coverage: createDataScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataScorecardPolicies(policies),
    validation: validateDataScorecardPolicies(policies),
    escalationDeck: createDataScorecardEscalationDeck(policies),
    analytics: {
      timeline: createDataScorecardAnalyticsTimeline(),
      forecast: createDataScorecardForecastEnvelope(),
      exceptions: createDataScorecardExceptionLedger(),
      summary: summarizeDataScorecardAnalytics()
    },
    operations: {
      board: createDataScorecardOperationsBoard(),
      checklist: createDataScorecardShiftChecklist(),
      incidents: createDataScorecardIncidentDeck()
    },
    reporting: {
      cards: createDataScorecardReportCards(),
      packets: createDataScorecardReviewPackets(),
      summary: summarizeDataScorecardReporting()
    },
    audit: {
      trail: createDataScorecardAuditTrail(),
      manifest: createDataScorecardEvidenceManifest(),
      attestation: createDataScorecardReadinessAttestation()
    },
    playbooks: createDataScorecardPlaybooks(),
    decisions: createDataScorecardDecisionDeck(),
    escalationMoments: createDataScorecardEscalationMoments()
  };
}

export function createDataScorecardReadinessBoard(snapshot = buildDataScorecardSnapshot()) {
  return [
    { id: 'data-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataScorecardApiDocument(snapshot = buildDataScorecardSnapshot()) {
  return {
    id: 'data-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-scorecard/overview' },
      { method: 'GET', path: '/api/data-scorecard/reporting' },
      { method: 'POST', path: '/api/data-scorecard/validate' },
      { method: 'GET', path: '/api/data-scorecard/audit' }
    ],
    readiness: createDataScorecardReadinessBoard(snapshot)
  };
}

export function createDataScorecardRouteSummary(snapshot = buildDataScorecardSnapshot()) {
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

