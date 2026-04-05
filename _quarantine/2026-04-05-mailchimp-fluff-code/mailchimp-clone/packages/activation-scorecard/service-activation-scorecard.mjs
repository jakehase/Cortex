import { createActivationScorecardWorkspace, summarizeActivationScorecardWorkspace, createActivationScorecardNarratives, createActivationScorecardCoverageGrid } from './domain-activation-scorecard.mjs';
import { createActivationScorecardPolicies, validateActivationScorecardPolicies, summarizeActivationScorecardPolicies, createActivationScorecardEscalationDeck } from './policies-activation-scorecard.mjs';
import { createActivationScorecardAnalyticsTimeline, createActivationScorecardForecastEnvelope, createActivationScorecardExceptionLedger, summarizeActivationScorecardAnalytics } from './analytics-activation-scorecard.mjs';
import { createActivationScorecardOperationsBoard, createActivationScorecardShiftChecklist, createActivationScorecardIncidentDeck } from './operations-activation-scorecard.mjs';
import { createActivationScorecardReportCards, createActivationScorecardReviewPackets, summarizeActivationScorecardReporting } from './reporting-activation-scorecard.mjs';
import { createActivationScorecardAuditTrail, createActivationScorecardEvidenceManifest, createActivationScorecardReadinessAttestation } from './audit-activation-scorecard.mjs';
import { createActivationScorecardPlaybooks, createActivationScorecardDecisionDeck, createActivationScorecardEscalationMoments } from './playbooks-activation-scorecard.mjs';

export function buildActivationScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationScorecardWorkspace(workspaceName);
  const policies = createActivationScorecardPolicies();
  return {
    workspace,
    summary: summarizeActivationScorecardWorkspace(workspace),
    narratives: createActivationScorecardNarratives(workspace),
    coverage: createActivationScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationScorecardPolicies(policies),
    validation: validateActivationScorecardPolicies(policies),
    escalationDeck: createActivationScorecardEscalationDeck(policies),
    analytics: {
      timeline: createActivationScorecardAnalyticsTimeline(),
      forecast: createActivationScorecardForecastEnvelope(),
      exceptions: createActivationScorecardExceptionLedger(),
      summary: summarizeActivationScorecardAnalytics()
    },
    operations: {
      board: createActivationScorecardOperationsBoard(),
      checklist: createActivationScorecardShiftChecklist(),
      incidents: createActivationScorecardIncidentDeck()
    },
    reporting: {
      cards: createActivationScorecardReportCards(),
      packets: createActivationScorecardReviewPackets(),
      summary: summarizeActivationScorecardReporting()
    },
    audit: {
      trail: createActivationScorecardAuditTrail(),
      manifest: createActivationScorecardEvidenceManifest(),
      attestation: createActivationScorecardReadinessAttestation()
    },
    playbooks: createActivationScorecardPlaybooks(),
    decisions: createActivationScorecardDecisionDeck(),
    escalationMoments: createActivationScorecardEscalationMoments()
  };
}

export function createActivationScorecardReadinessBoard(snapshot = buildActivationScorecardSnapshot()) {
  return [
    { id: 'activation-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationScorecardApiDocument(snapshot = buildActivationScorecardSnapshot()) {
  return {
    id: 'activation-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-scorecard/overview' },
      { method: 'GET', path: '/api/activation-scorecard/reporting' },
      { method: 'POST', path: '/api/activation-scorecard/validate' },
      { method: 'GET', path: '/api/activation-scorecard/audit' }
    ],
    readiness: createActivationScorecardReadinessBoard(snapshot)
  };
}

export function createActivationScorecardRouteSummary(snapshot = buildActivationScorecardSnapshot()) {
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

