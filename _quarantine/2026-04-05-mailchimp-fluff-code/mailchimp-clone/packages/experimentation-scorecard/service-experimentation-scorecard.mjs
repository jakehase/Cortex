import { createExperimentationScorecardWorkspace, summarizeExperimentationScorecardWorkspace, createExperimentationScorecardNarratives, createExperimentationScorecardCoverageGrid } from './domain-experimentation-scorecard.mjs';
import { createExperimentationScorecardPolicies, validateExperimentationScorecardPolicies, summarizeExperimentationScorecardPolicies, createExperimentationScorecardEscalationDeck } from './policies-experimentation-scorecard.mjs';
import { createExperimentationScorecardAnalyticsTimeline, createExperimentationScorecardForecastEnvelope, createExperimentationScorecardExceptionLedger, summarizeExperimentationScorecardAnalytics } from './analytics-experimentation-scorecard.mjs';
import { createExperimentationScorecardOperationsBoard, createExperimentationScorecardShiftChecklist, createExperimentationScorecardIncidentDeck } from './operations-experimentation-scorecard.mjs';
import { createExperimentationScorecardReportCards, createExperimentationScorecardReviewPackets, summarizeExperimentationScorecardReporting } from './reporting-experimentation-scorecard.mjs';
import { createExperimentationScorecardAuditTrail, createExperimentationScorecardEvidenceManifest, createExperimentationScorecardReadinessAttestation } from './audit-experimentation-scorecard.mjs';
import { createExperimentationScorecardPlaybooks, createExperimentationScorecardDecisionDeck, createExperimentationScorecardEscalationMoments } from './playbooks-experimentation-scorecard.mjs';

export function buildExperimentationScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationScorecardWorkspace(workspaceName);
  const policies = createExperimentationScorecardPolicies();
  return {
    workspace,
    summary: summarizeExperimentationScorecardWorkspace(workspace),
    narratives: createExperimentationScorecardNarratives(workspace),
    coverage: createExperimentationScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationScorecardPolicies(policies),
    validation: validateExperimentationScorecardPolicies(policies),
    escalationDeck: createExperimentationScorecardEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationScorecardAnalyticsTimeline(),
      forecast: createExperimentationScorecardForecastEnvelope(),
      exceptions: createExperimentationScorecardExceptionLedger(),
      summary: summarizeExperimentationScorecardAnalytics()
    },
    operations: {
      board: createExperimentationScorecardOperationsBoard(),
      checklist: createExperimentationScorecardShiftChecklist(),
      incidents: createExperimentationScorecardIncidentDeck()
    },
    reporting: {
      cards: createExperimentationScorecardReportCards(),
      packets: createExperimentationScorecardReviewPackets(),
      summary: summarizeExperimentationScorecardReporting()
    },
    audit: {
      trail: createExperimentationScorecardAuditTrail(),
      manifest: createExperimentationScorecardEvidenceManifest(),
      attestation: createExperimentationScorecardReadinessAttestation()
    },
    playbooks: createExperimentationScorecardPlaybooks(),
    decisions: createExperimentationScorecardDecisionDeck(),
    escalationMoments: createExperimentationScorecardEscalationMoments()
  };
}

export function createExperimentationScorecardReadinessBoard(snapshot = buildExperimentationScorecardSnapshot()) {
  return [
    { id: 'experimentation-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationScorecardApiDocument(snapshot = buildExperimentationScorecardSnapshot()) {
  return {
    id: 'experimentation-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-scorecard/overview' },
      { method: 'GET', path: '/api/experimentation-scorecard/reporting' },
      { method: 'POST', path: '/api/experimentation-scorecard/validate' },
      { method: 'GET', path: '/api/experimentation-scorecard/audit' }
    ],
    readiness: createExperimentationScorecardReadinessBoard(snapshot)
  };
}

export function createExperimentationScorecardRouteSummary(snapshot = buildExperimentationScorecardSnapshot()) {
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

