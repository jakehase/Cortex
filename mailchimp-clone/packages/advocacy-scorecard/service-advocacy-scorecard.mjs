import { createAdvocacyScorecardWorkspace, summarizeAdvocacyScorecardWorkspace, createAdvocacyScorecardNarratives, createAdvocacyScorecardCoverageGrid } from './domain-advocacy-scorecard.mjs';
import { createAdvocacyScorecardPolicies, validateAdvocacyScorecardPolicies, summarizeAdvocacyScorecardPolicies, createAdvocacyScorecardEscalationDeck } from './policies-advocacy-scorecard.mjs';
import { createAdvocacyScorecardAnalyticsTimeline, createAdvocacyScorecardForecastEnvelope, createAdvocacyScorecardExceptionLedger, summarizeAdvocacyScorecardAnalytics } from './analytics-advocacy-scorecard.mjs';
import { createAdvocacyScorecardOperationsBoard, createAdvocacyScorecardShiftChecklist, createAdvocacyScorecardIncidentDeck } from './operations-advocacy-scorecard.mjs';
import { createAdvocacyScorecardReportCards, createAdvocacyScorecardReviewPackets, summarizeAdvocacyScorecardReporting } from './reporting-advocacy-scorecard.mjs';
import { createAdvocacyScorecardAuditTrail, createAdvocacyScorecardEvidenceManifest, createAdvocacyScorecardReadinessAttestation } from './audit-advocacy-scorecard.mjs';
import { createAdvocacyScorecardPlaybooks, createAdvocacyScorecardDecisionDeck, createAdvocacyScorecardEscalationMoments } from './playbooks-advocacy-scorecard.mjs';

export function buildAdvocacyScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyScorecardWorkspace(workspaceName);
  const policies = createAdvocacyScorecardPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyScorecardWorkspace(workspace),
    narratives: createAdvocacyScorecardNarratives(workspace),
    coverage: createAdvocacyScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyScorecardPolicies(policies),
    validation: validateAdvocacyScorecardPolicies(policies),
    escalationDeck: createAdvocacyScorecardEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyScorecardAnalyticsTimeline(),
      forecast: createAdvocacyScorecardForecastEnvelope(),
      exceptions: createAdvocacyScorecardExceptionLedger(),
      summary: summarizeAdvocacyScorecardAnalytics()
    },
    operations: {
      board: createAdvocacyScorecardOperationsBoard(),
      checklist: createAdvocacyScorecardShiftChecklist(),
      incidents: createAdvocacyScorecardIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyScorecardReportCards(),
      packets: createAdvocacyScorecardReviewPackets(),
      summary: summarizeAdvocacyScorecardReporting()
    },
    audit: {
      trail: createAdvocacyScorecardAuditTrail(),
      manifest: createAdvocacyScorecardEvidenceManifest(),
      attestation: createAdvocacyScorecardReadinessAttestation()
    },
    playbooks: createAdvocacyScorecardPlaybooks(),
    decisions: createAdvocacyScorecardDecisionDeck(),
    escalationMoments: createAdvocacyScorecardEscalationMoments()
  };
}

export function createAdvocacyScorecardReadinessBoard(snapshot = buildAdvocacyScorecardSnapshot()) {
  return [
    { id: 'advocacy-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyScorecardApiDocument(snapshot = buildAdvocacyScorecardSnapshot()) {
  return {
    id: 'advocacy-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-scorecard/overview' },
      { method: 'GET', path: '/api/advocacy-scorecard/reporting' },
      { method: 'POST', path: '/api/advocacy-scorecard/validate' },
      { method: 'GET', path: '/api/advocacy-scorecard/audit' }
    ],
    readiness: createAdvocacyScorecardReadinessBoard(snapshot)
  };
}

export function createAdvocacyScorecardRouteSummary(snapshot = buildAdvocacyScorecardSnapshot()) {
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

