import { createIntegrationsScorecardWorkspace, summarizeIntegrationsScorecardWorkspace, createIntegrationsScorecardNarratives, createIntegrationsScorecardCoverageGrid } from './domain-integrations-scorecard.mjs';
import { createIntegrationsScorecardPolicies, validateIntegrationsScorecardPolicies, summarizeIntegrationsScorecardPolicies, createIntegrationsScorecardEscalationDeck } from './policies-integrations-scorecard.mjs';
import { createIntegrationsScorecardAnalyticsTimeline, createIntegrationsScorecardForecastEnvelope, createIntegrationsScorecardExceptionLedger, summarizeIntegrationsScorecardAnalytics } from './analytics-integrations-scorecard.mjs';
import { createIntegrationsScorecardOperationsBoard, createIntegrationsScorecardShiftChecklist, createIntegrationsScorecardIncidentDeck } from './operations-integrations-scorecard.mjs';
import { createIntegrationsScorecardReportCards, createIntegrationsScorecardReviewPackets, summarizeIntegrationsScorecardReporting } from './reporting-integrations-scorecard.mjs';
import { createIntegrationsScorecardAuditTrail, createIntegrationsScorecardEvidenceManifest, createIntegrationsScorecardReadinessAttestation } from './audit-integrations-scorecard.mjs';
import { createIntegrationsScorecardPlaybooks, createIntegrationsScorecardDecisionDeck, createIntegrationsScorecardEscalationMoments } from './playbooks-integrations-scorecard.mjs';

export function buildIntegrationsScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsScorecardWorkspace(workspaceName);
  const policies = createIntegrationsScorecardPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsScorecardWorkspace(workspace),
    narratives: createIntegrationsScorecardNarratives(workspace),
    coverage: createIntegrationsScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsScorecardPolicies(policies),
    validation: validateIntegrationsScorecardPolicies(policies),
    escalationDeck: createIntegrationsScorecardEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsScorecardAnalyticsTimeline(),
      forecast: createIntegrationsScorecardForecastEnvelope(),
      exceptions: createIntegrationsScorecardExceptionLedger(),
      summary: summarizeIntegrationsScorecardAnalytics()
    },
    operations: {
      board: createIntegrationsScorecardOperationsBoard(),
      checklist: createIntegrationsScorecardShiftChecklist(),
      incidents: createIntegrationsScorecardIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsScorecardReportCards(),
      packets: createIntegrationsScorecardReviewPackets(),
      summary: summarizeIntegrationsScorecardReporting()
    },
    audit: {
      trail: createIntegrationsScorecardAuditTrail(),
      manifest: createIntegrationsScorecardEvidenceManifest(),
      attestation: createIntegrationsScorecardReadinessAttestation()
    },
    playbooks: createIntegrationsScorecardPlaybooks(),
    decisions: createIntegrationsScorecardDecisionDeck(),
    escalationMoments: createIntegrationsScorecardEscalationMoments()
  };
}

export function createIntegrationsScorecardReadinessBoard(snapshot = buildIntegrationsScorecardSnapshot()) {
  return [
    { id: 'integrations-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsScorecardApiDocument(snapshot = buildIntegrationsScorecardSnapshot()) {
  return {
    id: 'integrations-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-scorecard/overview' },
      { method: 'GET', path: '/api/integrations-scorecard/reporting' },
      { method: 'POST', path: '/api/integrations-scorecard/validate' },
      { method: 'GET', path: '/api/integrations-scorecard/audit' }
    ],
    readiness: createIntegrationsScorecardReadinessBoard(snapshot)
  };
}

export function createIntegrationsScorecardRouteSummary(snapshot = buildIntegrationsScorecardSnapshot()) {
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

