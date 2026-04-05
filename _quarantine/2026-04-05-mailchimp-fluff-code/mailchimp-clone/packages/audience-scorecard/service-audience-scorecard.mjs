import { createAudienceScorecardWorkspace, summarizeAudienceScorecardWorkspace, createAudienceScorecardNarratives, createAudienceScorecardCoverageGrid } from './domain-audience-scorecard.mjs';
import { createAudienceScorecardPolicies, validateAudienceScorecardPolicies, summarizeAudienceScorecardPolicies, createAudienceScorecardEscalationDeck } from './policies-audience-scorecard.mjs';
import { createAudienceScorecardAnalyticsTimeline, createAudienceScorecardForecastEnvelope, createAudienceScorecardExceptionLedger, summarizeAudienceScorecardAnalytics } from './analytics-audience-scorecard.mjs';
import { createAudienceScorecardOperationsBoard, createAudienceScorecardShiftChecklist, createAudienceScorecardIncidentDeck } from './operations-audience-scorecard.mjs';
import { createAudienceScorecardReportCards, createAudienceScorecardReviewPackets, summarizeAudienceScorecardReporting } from './reporting-audience-scorecard.mjs';
import { createAudienceScorecardAuditTrail, createAudienceScorecardEvidenceManifest, createAudienceScorecardReadinessAttestation } from './audit-audience-scorecard.mjs';
import { createAudienceScorecardPlaybooks, createAudienceScorecardDecisionDeck, createAudienceScorecardEscalationMoments } from './playbooks-audience-scorecard.mjs';

export function buildAudienceScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceScorecardWorkspace(workspaceName);
  const policies = createAudienceScorecardPolicies();
  return {
    workspace,
    summary: summarizeAudienceScorecardWorkspace(workspace),
    narratives: createAudienceScorecardNarratives(workspace),
    coverage: createAudienceScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceScorecardPolicies(policies),
    validation: validateAudienceScorecardPolicies(policies),
    escalationDeck: createAudienceScorecardEscalationDeck(policies),
    analytics: {
      timeline: createAudienceScorecardAnalyticsTimeline(),
      forecast: createAudienceScorecardForecastEnvelope(),
      exceptions: createAudienceScorecardExceptionLedger(),
      summary: summarizeAudienceScorecardAnalytics()
    },
    operations: {
      board: createAudienceScorecardOperationsBoard(),
      checklist: createAudienceScorecardShiftChecklist(),
      incidents: createAudienceScorecardIncidentDeck()
    },
    reporting: {
      cards: createAudienceScorecardReportCards(),
      packets: createAudienceScorecardReviewPackets(),
      summary: summarizeAudienceScorecardReporting()
    },
    audit: {
      trail: createAudienceScorecardAuditTrail(),
      manifest: createAudienceScorecardEvidenceManifest(),
      attestation: createAudienceScorecardReadinessAttestation()
    },
    playbooks: createAudienceScorecardPlaybooks(),
    decisions: createAudienceScorecardDecisionDeck(),
    escalationMoments: createAudienceScorecardEscalationMoments()
  };
}

export function createAudienceScorecardReadinessBoard(snapshot = buildAudienceScorecardSnapshot()) {
  return [
    { id: 'audience-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceScorecardApiDocument(snapshot = buildAudienceScorecardSnapshot()) {
  return {
    id: 'audience-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-scorecard/overview' },
      { method: 'GET', path: '/api/audience-scorecard/reporting' },
      { method: 'POST', path: '/api/audience-scorecard/validate' },
      { method: 'GET', path: '/api/audience-scorecard/audit' }
    ],
    readiness: createAudienceScorecardReadinessBoard(snapshot)
  };
}

export function createAudienceScorecardRouteSummary(snapshot = buildAudienceScorecardSnapshot()) {
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

