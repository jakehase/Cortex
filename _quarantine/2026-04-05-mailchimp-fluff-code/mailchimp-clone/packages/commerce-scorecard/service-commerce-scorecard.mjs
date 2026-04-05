import { createCommerceScorecardWorkspace, summarizeCommerceScorecardWorkspace, createCommerceScorecardNarratives, createCommerceScorecardCoverageGrid } from './domain-commerce-scorecard.mjs';
import { createCommerceScorecardPolicies, validateCommerceScorecardPolicies, summarizeCommerceScorecardPolicies, createCommerceScorecardEscalationDeck } from './policies-commerce-scorecard.mjs';
import { createCommerceScorecardAnalyticsTimeline, createCommerceScorecardForecastEnvelope, createCommerceScorecardExceptionLedger, summarizeCommerceScorecardAnalytics } from './analytics-commerce-scorecard.mjs';
import { createCommerceScorecardOperationsBoard, createCommerceScorecardShiftChecklist, createCommerceScorecardIncidentDeck } from './operations-commerce-scorecard.mjs';
import { createCommerceScorecardReportCards, createCommerceScorecardReviewPackets, summarizeCommerceScorecardReporting } from './reporting-commerce-scorecard.mjs';
import { createCommerceScorecardAuditTrail, createCommerceScorecardEvidenceManifest, createCommerceScorecardReadinessAttestation } from './audit-commerce-scorecard.mjs';
import { createCommerceScorecardPlaybooks, createCommerceScorecardDecisionDeck, createCommerceScorecardEscalationMoments } from './playbooks-commerce-scorecard.mjs';

export function buildCommerceScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceScorecardWorkspace(workspaceName);
  const policies = createCommerceScorecardPolicies();
  return {
    workspace,
    summary: summarizeCommerceScorecardWorkspace(workspace),
    narratives: createCommerceScorecardNarratives(workspace),
    coverage: createCommerceScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceScorecardPolicies(policies),
    validation: validateCommerceScorecardPolicies(policies),
    escalationDeck: createCommerceScorecardEscalationDeck(policies),
    analytics: {
      timeline: createCommerceScorecardAnalyticsTimeline(),
      forecast: createCommerceScorecardForecastEnvelope(),
      exceptions: createCommerceScorecardExceptionLedger(),
      summary: summarizeCommerceScorecardAnalytics()
    },
    operations: {
      board: createCommerceScorecardOperationsBoard(),
      checklist: createCommerceScorecardShiftChecklist(),
      incidents: createCommerceScorecardIncidentDeck()
    },
    reporting: {
      cards: createCommerceScorecardReportCards(),
      packets: createCommerceScorecardReviewPackets(),
      summary: summarizeCommerceScorecardReporting()
    },
    audit: {
      trail: createCommerceScorecardAuditTrail(),
      manifest: createCommerceScorecardEvidenceManifest(),
      attestation: createCommerceScorecardReadinessAttestation()
    },
    playbooks: createCommerceScorecardPlaybooks(),
    decisions: createCommerceScorecardDecisionDeck(),
    escalationMoments: createCommerceScorecardEscalationMoments()
  };
}

export function createCommerceScorecardReadinessBoard(snapshot = buildCommerceScorecardSnapshot()) {
  return [
    { id: 'commerce-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceScorecardApiDocument(snapshot = buildCommerceScorecardSnapshot()) {
  return {
    id: 'commerce-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-scorecard/overview' },
      { method: 'GET', path: '/api/commerce-scorecard/reporting' },
      { method: 'POST', path: '/api/commerce-scorecard/validate' },
      { method: 'GET', path: '/api/commerce-scorecard/audit' }
    ],
    readiness: createCommerceScorecardReadinessBoard(snapshot)
  };
}

export function createCommerceScorecardRouteSummary(snapshot = buildCommerceScorecardSnapshot()) {
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

