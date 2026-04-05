import { createLocalizationPlannerWorkspace, summarizeLocalizationPlannerWorkspace, createLocalizationPlannerNarratives, createLocalizationPlannerCoverageGrid } from './domain-localization-planner.mjs';
import { createLocalizationPlannerPolicies, validateLocalizationPlannerPolicies, summarizeLocalizationPlannerPolicies, createLocalizationPlannerEscalationDeck } from './policies-localization-planner.mjs';
import { createLocalizationPlannerAnalyticsTimeline, createLocalizationPlannerForecastEnvelope, createLocalizationPlannerExceptionLedger, summarizeLocalizationPlannerAnalytics } from './analytics-localization-planner.mjs';
import { createLocalizationPlannerOperationsBoard, createLocalizationPlannerShiftChecklist, createLocalizationPlannerIncidentDeck } from './operations-localization-planner.mjs';
import { createLocalizationPlannerReportCards, createLocalizationPlannerReviewPackets, summarizeLocalizationPlannerReporting } from './reporting-localization-planner.mjs';
import { createLocalizationPlannerAuditTrail, createLocalizationPlannerEvidenceManifest, createLocalizationPlannerReadinessAttestation } from './audit-localization-planner.mjs';
import { createLocalizationPlannerPlaybooks, createLocalizationPlannerDecisionDeck, createLocalizationPlannerEscalationMoments } from './playbooks-localization-planner.mjs';

export function buildLocalizationPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationPlannerWorkspace(workspaceName);
  const policies = createLocalizationPlannerPolicies();
  return {
    workspace,
    summary: summarizeLocalizationPlannerWorkspace(workspace),
    narratives: createLocalizationPlannerNarratives(workspace),
    coverage: createLocalizationPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationPlannerPolicies(policies),
    validation: validateLocalizationPlannerPolicies(policies),
    escalationDeck: createLocalizationPlannerEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationPlannerAnalyticsTimeline(),
      forecast: createLocalizationPlannerForecastEnvelope(),
      exceptions: createLocalizationPlannerExceptionLedger(),
      summary: summarizeLocalizationPlannerAnalytics()
    },
    operations: {
      board: createLocalizationPlannerOperationsBoard(),
      checklist: createLocalizationPlannerShiftChecklist(),
      incidents: createLocalizationPlannerIncidentDeck()
    },
    reporting: {
      cards: createLocalizationPlannerReportCards(),
      packets: createLocalizationPlannerReviewPackets(),
      summary: summarizeLocalizationPlannerReporting()
    },
    audit: {
      trail: createLocalizationPlannerAuditTrail(),
      manifest: createLocalizationPlannerEvidenceManifest(),
      attestation: createLocalizationPlannerReadinessAttestation()
    },
    playbooks: createLocalizationPlannerPlaybooks(),
    decisions: createLocalizationPlannerDecisionDeck(),
    escalationMoments: createLocalizationPlannerEscalationMoments()
  };
}

export function createLocalizationPlannerReadinessBoard(snapshot = buildLocalizationPlannerSnapshot()) {
  return [
    { id: 'localization-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationPlannerApiDocument(snapshot = buildLocalizationPlannerSnapshot()) {
  return {
    id: 'localization-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-planner/overview' },
      { method: 'GET', path: '/api/localization-planner/reporting' },
      { method: 'POST', path: '/api/localization-planner/validate' },
      { method: 'GET', path: '/api/localization-planner/audit' }
    ],
    readiness: createLocalizationPlannerReadinessBoard(snapshot)
  };
}

export function createLocalizationPlannerRouteSummary(snapshot = buildLocalizationPlannerSnapshot()) {
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

