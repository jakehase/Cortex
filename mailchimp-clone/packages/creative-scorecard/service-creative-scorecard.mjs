import { createCreativeScorecardWorkspace, summarizeCreativeScorecardWorkspace, createCreativeScorecardNarratives, createCreativeScorecardCoverageGrid } from './domain-creative-scorecard.mjs';
import { createCreativeScorecardPolicies, validateCreativeScorecardPolicies, summarizeCreativeScorecardPolicies, createCreativeScorecardEscalationDeck } from './policies-creative-scorecard.mjs';
import { createCreativeScorecardAnalyticsTimeline, createCreativeScorecardForecastEnvelope, createCreativeScorecardExceptionLedger, summarizeCreativeScorecardAnalytics } from './analytics-creative-scorecard.mjs';
import { createCreativeScorecardOperationsBoard, createCreativeScorecardShiftChecklist, createCreativeScorecardIncidentDeck } from './operations-creative-scorecard.mjs';
import { createCreativeScorecardReportCards, createCreativeScorecardReviewPackets, summarizeCreativeScorecardReporting } from './reporting-creative-scorecard.mjs';
import { createCreativeScorecardAuditTrail, createCreativeScorecardEvidenceManifest, createCreativeScorecardReadinessAttestation } from './audit-creative-scorecard.mjs';
import { createCreativeScorecardPlaybooks, createCreativeScorecardDecisionDeck, createCreativeScorecardEscalationMoments } from './playbooks-creative-scorecard.mjs';

export function buildCreativeScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeScorecardWorkspace(workspaceName);
  const policies = createCreativeScorecardPolicies();
  return {
    workspace,
    summary: summarizeCreativeScorecardWorkspace(workspace),
    narratives: createCreativeScorecardNarratives(workspace),
    coverage: createCreativeScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeScorecardPolicies(policies),
    validation: validateCreativeScorecardPolicies(policies),
    escalationDeck: createCreativeScorecardEscalationDeck(policies),
    analytics: {
      timeline: createCreativeScorecardAnalyticsTimeline(),
      forecast: createCreativeScorecardForecastEnvelope(),
      exceptions: createCreativeScorecardExceptionLedger(),
      summary: summarizeCreativeScorecardAnalytics()
    },
    operations: {
      board: createCreativeScorecardOperationsBoard(),
      checklist: createCreativeScorecardShiftChecklist(),
      incidents: createCreativeScorecardIncidentDeck()
    },
    reporting: {
      cards: createCreativeScorecardReportCards(),
      packets: createCreativeScorecardReviewPackets(),
      summary: summarizeCreativeScorecardReporting()
    },
    audit: {
      trail: createCreativeScorecardAuditTrail(),
      manifest: createCreativeScorecardEvidenceManifest(),
      attestation: createCreativeScorecardReadinessAttestation()
    },
    playbooks: createCreativeScorecardPlaybooks(),
    decisions: createCreativeScorecardDecisionDeck(),
    escalationMoments: createCreativeScorecardEscalationMoments()
  };
}

export function createCreativeScorecardReadinessBoard(snapshot = buildCreativeScorecardSnapshot()) {
  return [
    { id: 'creative-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeScorecardApiDocument(snapshot = buildCreativeScorecardSnapshot()) {
  return {
    id: 'creative-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-scorecard/overview' },
      { method: 'GET', path: '/api/creative-scorecard/reporting' },
      { method: 'POST', path: '/api/creative-scorecard/validate' },
      { method: 'GET', path: '/api/creative-scorecard/audit' }
    ],
    readiness: createCreativeScorecardReadinessBoard(snapshot)
  };
}

export function createCreativeScorecardRouteSummary(snapshot = buildCreativeScorecardSnapshot()) {
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

