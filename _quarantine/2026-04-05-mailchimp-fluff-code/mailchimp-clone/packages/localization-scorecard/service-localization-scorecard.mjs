import { createLocalizationScorecardWorkspace, summarizeLocalizationScorecardWorkspace, createLocalizationScorecardNarratives, createLocalizationScorecardCoverageGrid } from './domain-localization-scorecard.mjs';
import { createLocalizationScorecardPolicies, validateLocalizationScorecardPolicies, summarizeLocalizationScorecardPolicies, createLocalizationScorecardEscalationDeck } from './policies-localization-scorecard.mjs';
import { createLocalizationScorecardAnalyticsTimeline, createLocalizationScorecardForecastEnvelope, createLocalizationScorecardExceptionLedger, summarizeLocalizationScorecardAnalytics } from './analytics-localization-scorecard.mjs';
import { createLocalizationScorecardOperationsBoard, createLocalizationScorecardShiftChecklist, createLocalizationScorecardIncidentDeck } from './operations-localization-scorecard.mjs';
import { createLocalizationScorecardReportCards, createLocalizationScorecardReviewPackets, summarizeLocalizationScorecardReporting } from './reporting-localization-scorecard.mjs';
import { createLocalizationScorecardAuditTrail, createLocalizationScorecardEvidenceManifest, createLocalizationScorecardReadinessAttestation } from './audit-localization-scorecard.mjs';
import { createLocalizationScorecardPlaybooks, createLocalizationScorecardDecisionDeck, createLocalizationScorecardEscalationMoments } from './playbooks-localization-scorecard.mjs';

export function buildLocalizationScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationScorecardWorkspace(workspaceName);
  const policies = createLocalizationScorecardPolicies();
  return {
    workspace,
    summary: summarizeLocalizationScorecardWorkspace(workspace),
    narratives: createLocalizationScorecardNarratives(workspace),
    coverage: createLocalizationScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationScorecardPolicies(policies),
    validation: validateLocalizationScorecardPolicies(policies),
    escalationDeck: createLocalizationScorecardEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationScorecardAnalyticsTimeline(),
      forecast: createLocalizationScorecardForecastEnvelope(),
      exceptions: createLocalizationScorecardExceptionLedger(),
      summary: summarizeLocalizationScorecardAnalytics()
    },
    operations: {
      board: createLocalizationScorecardOperationsBoard(),
      checklist: createLocalizationScorecardShiftChecklist(),
      incidents: createLocalizationScorecardIncidentDeck()
    },
    reporting: {
      cards: createLocalizationScorecardReportCards(),
      packets: createLocalizationScorecardReviewPackets(),
      summary: summarizeLocalizationScorecardReporting()
    },
    audit: {
      trail: createLocalizationScorecardAuditTrail(),
      manifest: createLocalizationScorecardEvidenceManifest(),
      attestation: createLocalizationScorecardReadinessAttestation()
    },
    playbooks: createLocalizationScorecardPlaybooks(),
    decisions: createLocalizationScorecardDecisionDeck(),
    escalationMoments: createLocalizationScorecardEscalationMoments()
  };
}

export function createLocalizationScorecardReadinessBoard(snapshot = buildLocalizationScorecardSnapshot()) {
  return [
    { id: 'localization-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationScorecardApiDocument(snapshot = buildLocalizationScorecardSnapshot()) {
  return {
    id: 'localization-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-scorecard/overview' },
      { method: 'GET', path: '/api/localization-scorecard/reporting' },
      { method: 'POST', path: '/api/localization-scorecard/validate' },
      { method: 'GET', path: '/api/localization-scorecard/audit' }
    ],
    readiness: createLocalizationScorecardReadinessBoard(snapshot)
  };
}

export function createLocalizationScorecardRouteSummary(snapshot = buildLocalizationScorecardSnapshot()) {
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

