import { createLoyaltyScorecardWorkspace, summarizeLoyaltyScorecardWorkspace, createLoyaltyScorecardNarratives, createLoyaltyScorecardCoverageGrid } from './domain-loyalty-scorecard.mjs';
import { createLoyaltyScorecardPolicies, validateLoyaltyScorecardPolicies, summarizeLoyaltyScorecardPolicies, createLoyaltyScorecardEscalationDeck } from './policies-loyalty-scorecard.mjs';
import { createLoyaltyScorecardAnalyticsTimeline, createLoyaltyScorecardForecastEnvelope, createLoyaltyScorecardExceptionLedger, summarizeLoyaltyScorecardAnalytics } from './analytics-loyalty-scorecard.mjs';
import { createLoyaltyScorecardOperationsBoard, createLoyaltyScorecardShiftChecklist, createLoyaltyScorecardIncidentDeck } from './operations-loyalty-scorecard.mjs';
import { createLoyaltyScorecardReportCards, createLoyaltyScorecardReviewPackets, summarizeLoyaltyScorecardReporting } from './reporting-loyalty-scorecard.mjs';
import { createLoyaltyScorecardAuditTrail, createLoyaltyScorecardEvidenceManifest, createLoyaltyScorecardReadinessAttestation } from './audit-loyalty-scorecard.mjs';
import { createLoyaltyScorecardPlaybooks, createLoyaltyScorecardDecisionDeck, createLoyaltyScorecardEscalationMoments } from './playbooks-loyalty-scorecard.mjs';

export function buildLoyaltyScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyScorecardWorkspace(workspaceName);
  const policies = createLoyaltyScorecardPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyScorecardWorkspace(workspace),
    narratives: createLoyaltyScorecardNarratives(workspace),
    coverage: createLoyaltyScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyScorecardPolicies(policies),
    validation: validateLoyaltyScorecardPolicies(policies),
    escalationDeck: createLoyaltyScorecardEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyScorecardAnalyticsTimeline(),
      forecast: createLoyaltyScorecardForecastEnvelope(),
      exceptions: createLoyaltyScorecardExceptionLedger(),
      summary: summarizeLoyaltyScorecardAnalytics()
    },
    operations: {
      board: createLoyaltyScorecardOperationsBoard(),
      checklist: createLoyaltyScorecardShiftChecklist(),
      incidents: createLoyaltyScorecardIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyScorecardReportCards(),
      packets: createLoyaltyScorecardReviewPackets(),
      summary: summarizeLoyaltyScorecardReporting()
    },
    audit: {
      trail: createLoyaltyScorecardAuditTrail(),
      manifest: createLoyaltyScorecardEvidenceManifest(),
      attestation: createLoyaltyScorecardReadinessAttestation()
    },
    playbooks: createLoyaltyScorecardPlaybooks(),
    decisions: createLoyaltyScorecardDecisionDeck(),
    escalationMoments: createLoyaltyScorecardEscalationMoments()
  };
}

export function createLoyaltyScorecardReadinessBoard(snapshot = buildLoyaltyScorecardSnapshot()) {
  return [
    { id: 'loyalty-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyScorecardApiDocument(snapshot = buildLoyaltyScorecardSnapshot()) {
  return {
    id: 'loyalty-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-scorecard/overview' },
      { method: 'GET', path: '/api/loyalty-scorecard/reporting' },
      { method: 'POST', path: '/api/loyalty-scorecard/validate' },
      { method: 'GET', path: '/api/loyalty-scorecard/audit' }
    ],
    readiness: createLoyaltyScorecardReadinessBoard(snapshot)
  };
}

export function createLoyaltyScorecardRouteSummary(snapshot = buildLoyaltyScorecardSnapshot()) {
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

