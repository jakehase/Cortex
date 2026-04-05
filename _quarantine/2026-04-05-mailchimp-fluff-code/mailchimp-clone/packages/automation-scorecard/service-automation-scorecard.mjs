import { createAutomationScorecardWorkspace, summarizeAutomationScorecardWorkspace, createAutomationScorecardNarratives, createAutomationScorecardCoverageGrid } from './domain-automation-scorecard.mjs';
import { createAutomationScorecardPolicies, validateAutomationScorecardPolicies, summarizeAutomationScorecardPolicies, createAutomationScorecardEscalationDeck } from './policies-automation-scorecard.mjs';
import { createAutomationScorecardAnalyticsTimeline, createAutomationScorecardForecastEnvelope, createAutomationScorecardExceptionLedger, summarizeAutomationScorecardAnalytics } from './analytics-automation-scorecard.mjs';
import { createAutomationScorecardOperationsBoard, createAutomationScorecardShiftChecklist, createAutomationScorecardIncidentDeck } from './operations-automation-scorecard.mjs';
import { createAutomationScorecardReportCards, createAutomationScorecardReviewPackets, summarizeAutomationScorecardReporting } from './reporting-automation-scorecard.mjs';
import { createAutomationScorecardAuditTrail, createAutomationScorecardEvidenceManifest, createAutomationScorecardReadinessAttestation } from './audit-automation-scorecard.mjs';
import { createAutomationScorecardPlaybooks, createAutomationScorecardDecisionDeck, createAutomationScorecardEscalationMoments } from './playbooks-automation-scorecard.mjs';

export function buildAutomationScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationScorecardWorkspace(workspaceName);
  const policies = createAutomationScorecardPolicies();
  return {
    workspace,
    summary: summarizeAutomationScorecardWorkspace(workspace),
    narratives: createAutomationScorecardNarratives(workspace),
    coverage: createAutomationScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationScorecardPolicies(policies),
    validation: validateAutomationScorecardPolicies(policies),
    escalationDeck: createAutomationScorecardEscalationDeck(policies),
    analytics: {
      timeline: createAutomationScorecardAnalyticsTimeline(),
      forecast: createAutomationScorecardForecastEnvelope(),
      exceptions: createAutomationScorecardExceptionLedger(),
      summary: summarizeAutomationScorecardAnalytics()
    },
    operations: {
      board: createAutomationScorecardOperationsBoard(),
      checklist: createAutomationScorecardShiftChecklist(),
      incidents: createAutomationScorecardIncidentDeck()
    },
    reporting: {
      cards: createAutomationScorecardReportCards(),
      packets: createAutomationScorecardReviewPackets(),
      summary: summarizeAutomationScorecardReporting()
    },
    audit: {
      trail: createAutomationScorecardAuditTrail(),
      manifest: createAutomationScorecardEvidenceManifest(),
      attestation: createAutomationScorecardReadinessAttestation()
    },
    playbooks: createAutomationScorecardPlaybooks(),
    decisions: createAutomationScorecardDecisionDeck(),
    escalationMoments: createAutomationScorecardEscalationMoments()
  };
}

export function createAutomationScorecardReadinessBoard(snapshot = buildAutomationScorecardSnapshot()) {
  return [
    { id: 'automation-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationScorecardApiDocument(snapshot = buildAutomationScorecardSnapshot()) {
  return {
    id: 'automation-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-scorecard/overview' },
      { method: 'GET', path: '/api/automation-scorecard/reporting' },
      { method: 'POST', path: '/api/automation-scorecard/validate' },
      { method: 'GET', path: '/api/automation-scorecard/audit' }
    ],
    readiness: createAutomationScorecardReadinessBoard(snapshot)
  };
}

export function createAutomationScorecardRouteSummary(snapshot = buildAutomationScorecardSnapshot()) {
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

