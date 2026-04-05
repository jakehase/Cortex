import { createAttributionScorecardWorkspace, summarizeAttributionScorecardWorkspace, createAttributionScorecardNarratives, createAttributionScorecardCoverageGrid } from './domain-attribution-scorecard.mjs';
import { createAttributionScorecardPolicies, validateAttributionScorecardPolicies, summarizeAttributionScorecardPolicies, createAttributionScorecardEscalationDeck } from './policies-attribution-scorecard.mjs';
import { createAttributionScorecardAnalyticsTimeline, createAttributionScorecardForecastEnvelope, createAttributionScorecardExceptionLedger, summarizeAttributionScorecardAnalytics } from './analytics-attribution-scorecard.mjs';
import { createAttributionScorecardOperationsBoard, createAttributionScorecardShiftChecklist, createAttributionScorecardIncidentDeck } from './operations-attribution-scorecard.mjs';
import { createAttributionScorecardReportCards, createAttributionScorecardReviewPackets, summarizeAttributionScorecardReporting } from './reporting-attribution-scorecard.mjs';
import { createAttributionScorecardAuditTrail, createAttributionScorecardEvidenceManifest, createAttributionScorecardReadinessAttestation } from './audit-attribution-scorecard.mjs';
import { createAttributionScorecardPlaybooks, createAttributionScorecardDecisionDeck, createAttributionScorecardEscalationMoments } from './playbooks-attribution-scorecard.mjs';

export function buildAttributionScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionScorecardWorkspace(workspaceName);
  const policies = createAttributionScorecardPolicies();
  return {
    workspace,
    summary: summarizeAttributionScorecardWorkspace(workspace),
    narratives: createAttributionScorecardNarratives(workspace),
    coverage: createAttributionScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionScorecardPolicies(policies),
    validation: validateAttributionScorecardPolicies(policies),
    escalationDeck: createAttributionScorecardEscalationDeck(policies),
    analytics: {
      timeline: createAttributionScorecardAnalyticsTimeline(),
      forecast: createAttributionScorecardForecastEnvelope(),
      exceptions: createAttributionScorecardExceptionLedger(),
      summary: summarizeAttributionScorecardAnalytics()
    },
    operations: {
      board: createAttributionScorecardOperationsBoard(),
      checklist: createAttributionScorecardShiftChecklist(),
      incidents: createAttributionScorecardIncidentDeck()
    },
    reporting: {
      cards: createAttributionScorecardReportCards(),
      packets: createAttributionScorecardReviewPackets(),
      summary: summarizeAttributionScorecardReporting()
    },
    audit: {
      trail: createAttributionScorecardAuditTrail(),
      manifest: createAttributionScorecardEvidenceManifest(),
      attestation: createAttributionScorecardReadinessAttestation()
    },
    playbooks: createAttributionScorecardPlaybooks(),
    decisions: createAttributionScorecardDecisionDeck(),
    escalationMoments: createAttributionScorecardEscalationMoments()
  };
}

export function createAttributionScorecardReadinessBoard(snapshot = buildAttributionScorecardSnapshot()) {
  return [
    { id: 'attribution-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionScorecardApiDocument(snapshot = buildAttributionScorecardSnapshot()) {
  return {
    id: 'attribution-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-scorecard/overview' },
      { method: 'GET', path: '/api/attribution-scorecard/reporting' },
      { method: 'POST', path: '/api/attribution-scorecard/validate' },
      { method: 'GET', path: '/api/attribution-scorecard/audit' }
    ],
    readiness: createAttributionScorecardReadinessBoard(snapshot)
  };
}

export function createAttributionScorecardRouteSummary(snapshot = buildAttributionScorecardSnapshot()) {
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

