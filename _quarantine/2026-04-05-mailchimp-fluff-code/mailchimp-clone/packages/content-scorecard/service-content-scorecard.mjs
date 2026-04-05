import { createContentScorecardWorkspace, summarizeContentScorecardWorkspace, createContentScorecardNarratives, createContentScorecardCoverageGrid } from './domain-content-scorecard.mjs';
import { createContentScorecardPolicies, validateContentScorecardPolicies, summarizeContentScorecardPolicies, createContentScorecardEscalationDeck } from './policies-content-scorecard.mjs';
import { createContentScorecardAnalyticsTimeline, createContentScorecardForecastEnvelope, createContentScorecardExceptionLedger, summarizeContentScorecardAnalytics } from './analytics-content-scorecard.mjs';
import { createContentScorecardOperationsBoard, createContentScorecardShiftChecklist, createContentScorecardIncidentDeck } from './operations-content-scorecard.mjs';
import { createContentScorecardReportCards, createContentScorecardReviewPackets, summarizeContentScorecardReporting } from './reporting-content-scorecard.mjs';
import { createContentScorecardAuditTrail, createContentScorecardEvidenceManifest, createContentScorecardReadinessAttestation } from './audit-content-scorecard.mjs';
import { createContentScorecardPlaybooks, createContentScorecardDecisionDeck, createContentScorecardEscalationMoments } from './playbooks-content-scorecard.mjs';

export function buildContentScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentScorecardWorkspace(workspaceName);
  const policies = createContentScorecardPolicies();
  return {
    workspace,
    summary: summarizeContentScorecardWorkspace(workspace),
    narratives: createContentScorecardNarratives(workspace),
    coverage: createContentScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentScorecardPolicies(policies),
    validation: validateContentScorecardPolicies(policies),
    escalationDeck: createContentScorecardEscalationDeck(policies),
    analytics: {
      timeline: createContentScorecardAnalyticsTimeline(),
      forecast: createContentScorecardForecastEnvelope(),
      exceptions: createContentScorecardExceptionLedger(),
      summary: summarizeContentScorecardAnalytics()
    },
    operations: {
      board: createContentScorecardOperationsBoard(),
      checklist: createContentScorecardShiftChecklist(),
      incidents: createContentScorecardIncidentDeck()
    },
    reporting: {
      cards: createContentScorecardReportCards(),
      packets: createContentScorecardReviewPackets(),
      summary: summarizeContentScorecardReporting()
    },
    audit: {
      trail: createContentScorecardAuditTrail(),
      manifest: createContentScorecardEvidenceManifest(),
      attestation: createContentScorecardReadinessAttestation()
    },
    playbooks: createContentScorecardPlaybooks(),
    decisions: createContentScorecardDecisionDeck(),
    escalationMoments: createContentScorecardEscalationMoments()
  };
}

export function createContentScorecardReadinessBoard(snapshot = buildContentScorecardSnapshot()) {
  return [
    { id: 'content-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentScorecardApiDocument(snapshot = buildContentScorecardSnapshot()) {
  return {
    id: 'content-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-scorecard/overview' },
      { method: 'GET', path: '/api/content-scorecard/reporting' },
      { method: 'POST', path: '/api/content-scorecard/validate' },
      { method: 'GET', path: '/api/content-scorecard/audit' }
    ],
    readiness: createContentScorecardReadinessBoard(snapshot)
  };
}

export function createContentScorecardRouteSummary(snapshot = buildContentScorecardSnapshot()) {
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

