import { createCollaborationScorecardWorkspace, summarizeCollaborationScorecardWorkspace, createCollaborationScorecardNarratives, createCollaborationScorecardCoverageGrid } from './domain-collaboration-scorecard.mjs';
import { createCollaborationScorecardPolicies, validateCollaborationScorecardPolicies, summarizeCollaborationScorecardPolicies, createCollaborationScorecardEscalationDeck } from './policies-collaboration-scorecard.mjs';
import { createCollaborationScorecardAnalyticsTimeline, createCollaborationScorecardForecastEnvelope, createCollaborationScorecardExceptionLedger, summarizeCollaborationScorecardAnalytics } from './analytics-collaboration-scorecard.mjs';
import { createCollaborationScorecardOperationsBoard, createCollaborationScorecardShiftChecklist, createCollaborationScorecardIncidentDeck } from './operations-collaboration-scorecard.mjs';
import { createCollaborationScorecardReportCards, createCollaborationScorecardReviewPackets, summarizeCollaborationScorecardReporting } from './reporting-collaboration-scorecard.mjs';
import { createCollaborationScorecardAuditTrail, createCollaborationScorecardEvidenceManifest, createCollaborationScorecardReadinessAttestation } from './audit-collaboration-scorecard.mjs';
import { createCollaborationScorecardPlaybooks, createCollaborationScorecardDecisionDeck, createCollaborationScorecardEscalationMoments } from './playbooks-collaboration-scorecard.mjs';

export function buildCollaborationScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationScorecardWorkspace(workspaceName);
  const policies = createCollaborationScorecardPolicies();
  return {
    workspace,
    summary: summarizeCollaborationScorecardWorkspace(workspace),
    narratives: createCollaborationScorecardNarratives(workspace),
    coverage: createCollaborationScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationScorecardPolicies(policies),
    validation: validateCollaborationScorecardPolicies(policies),
    escalationDeck: createCollaborationScorecardEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationScorecardAnalyticsTimeline(),
      forecast: createCollaborationScorecardForecastEnvelope(),
      exceptions: createCollaborationScorecardExceptionLedger(),
      summary: summarizeCollaborationScorecardAnalytics()
    },
    operations: {
      board: createCollaborationScorecardOperationsBoard(),
      checklist: createCollaborationScorecardShiftChecklist(),
      incidents: createCollaborationScorecardIncidentDeck()
    },
    reporting: {
      cards: createCollaborationScorecardReportCards(),
      packets: createCollaborationScorecardReviewPackets(),
      summary: summarizeCollaborationScorecardReporting()
    },
    audit: {
      trail: createCollaborationScorecardAuditTrail(),
      manifest: createCollaborationScorecardEvidenceManifest(),
      attestation: createCollaborationScorecardReadinessAttestation()
    },
    playbooks: createCollaborationScorecardPlaybooks(),
    decisions: createCollaborationScorecardDecisionDeck(),
    escalationMoments: createCollaborationScorecardEscalationMoments()
  };
}

export function createCollaborationScorecardReadinessBoard(snapshot = buildCollaborationScorecardSnapshot()) {
  return [
    { id: 'collaboration-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationScorecardApiDocument(snapshot = buildCollaborationScorecardSnapshot()) {
  return {
    id: 'collaboration-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-scorecard/overview' },
      { method: 'GET', path: '/api/collaboration-scorecard/reporting' },
      { method: 'POST', path: '/api/collaboration-scorecard/validate' },
      { method: 'GET', path: '/api/collaboration-scorecard/audit' }
    ],
    readiness: createCollaborationScorecardReadinessBoard(snapshot)
  };
}

export function createCollaborationScorecardRouteSummary(snapshot = buildCollaborationScorecardSnapshot()) {
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

