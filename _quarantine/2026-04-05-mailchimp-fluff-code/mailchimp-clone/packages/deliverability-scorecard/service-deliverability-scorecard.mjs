import { createDeliverabilityScorecardWorkspace, summarizeDeliverabilityScorecardWorkspace, createDeliverabilityScorecardNarratives, createDeliverabilityScorecardCoverageGrid } from './domain-deliverability-scorecard.mjs';
import { createDeliverabilityScorecardPolicies, validateDeliverabilityScorecardPolicies, summarizeDeliverabilityScorecardPolicies, createDeliverabilityScorecardEscalationDeck } from './policies-deliverability-scorecard.mjs';
import { createDeliverabilityScorecardAnalyticsTimeline, createDeliverabilityScorecardForecastEnvelope, createDeliverabilityScorecardExceptionLedger, summarizeDeliverabilityScorecardAnalytics } from './analytics-deliverability-scorecard.mjs';
import { createDeliverabilityScorecardOperationsBoard, createDeliverabilityScorecardShiftChecklist, createDeliverabilityScorecardIncidentDeck } from './operations-deliverability-scorecard.mjs';
import { createDeliverabilityScorecardReportCards, createDeliverabilityScorecardReviewPackets, summarizeDeliverabilityScorecardReporting } from './reporting-deliverability-scorecard.mjs';
import { createDeliverabilityScorecardAuditTrail, createDeliverabilityScorecardEvidenceManifest, createDeliverabilityScorecardReadinessAttestation } from './audit-deliverability-scorecard.mjs';
import { createDeliverabilityScorecardPlaybooks, createDeliverabilityScorecardDecisionDeck, createDeliverabilityScorecardEscalationMoments } from './playbooks-deliverability-scorecard.mjs';

export function buildDeliverabilityScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityScorecardWorkspace(workspaceName);
  const policies = createDeliverabilityScorecardPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityScorecardWorkspace(workspace),
    narratives: createDeliverabilityScorecardNarratives(workspace),
    coverage: createDeliverabilityScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityScorecardPolicies(policies),
    validation: validateDeliverabilityScorecardPolicies(policies),
    escalationDeck: createDeliverabilityScorecardEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityScorecardAnalyticsTimeline(),
      forecast: createDeliverabilityScorecardForecastEnvelope(),
      exceptions: createDeliverabilityScorecardExceptionLedger(),
      summary: summarizeDeliverabilityScorecardAnalytics()
    },
    operations: {
      board: createDeliverabilityScorecardOperationsBoard(),
      checklist: createDeliverabilityScorecardShiftChecklist(),
      incidents: createDeliverabilityScorecardIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityScorecardReportCards(),
      packets: createDeliverabilityScorecardReviewPackets(),
      summary: summarizeDeliverabilityScorecardReporting()
    },
    audit: {
      trail: createDeliverabilityScorecardAuditTrail(),
      manifest: createDeliverabilityScorecardEvidenceManifest(),
      attestation: createDeliverabilityScorecardReadinessAttestation()
    },
    playbooks: createDeliverabilityScorecardPlaybooks(),
    decisions: createDeliverabilityScorecardDecisionDeck(),
    escalationMoments: createDeliverabilityScorecardEscalationMoments()
  };
}

export function createDeliverabilityScorecardReadinessBoard(snapshot = buildDeliverabilityScorecardSnapshot()) {
  return [
    { id: 'deliverability-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityScorecardApiDocument(snapshot = buildDeliverabilityScorecardSnapshot()) {
  return {
    id: 'deliverability-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-scorecard/overview' },
      { method: 'GET', path: '/api/deliverability-scorecard/reporting' },
      { method: 'POST', path: '/api/deliverability-scorecard/validate' },
      { method: 'GET', path: '/api/deliverability-scorecard/audit' }
    ],
    readiness: createDeliverabilityScorecardReadinessBoard(snapshot)
  };
}

export function createDeliverabilityScorecardRouteSummary(snapshot = buildDeliverabilityScorecardSnapshot()) {
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

