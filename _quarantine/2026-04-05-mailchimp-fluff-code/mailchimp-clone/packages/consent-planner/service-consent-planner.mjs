import { createConsentPlannerWorkspace, summarizeConsentPlannerWorkspace, createConsentPlannerNarratives, createConsentPlannerCoverageGrid } from './domain-consent-planner.mjs';
import { createConsentPlannerPolicies, validateConsentPlannerPolicies, summarizeConsentPlannerPolicies, createConsentPlannerEscalationDeck } from './policies-consent-planner.mjs';
import { createConsentPlannerAnalyticsTimeline, createConsentPlannerForecastEnvelope, createConsentPlannerExceptionLedger, summarizeConsentPlannerAnalytics } from './analytics-consent-planner.mjs';
import { createConsentPlannerOperationsBoard, createConsentPlannerShiftChecklist, createConsentPlannerIncidentDeck } from './operations-consent-planner.mjs';
import { createConsentPlannerReportCards, createConsentPlannerReviewPackets, summarizeConsentPlannerReporting } from './reporting-consent-planner.mjs';
import { createConsentPlannerAuditTrail, createConsentPlannerEvidenceManifest, createConsentPlannerReadinessAttestation } from './audit-consent-planner.mjs';
import { createConsentPlannerPlaybooks, createConsentPlannerDecisionDeck, createConsentPlannerEscalationMoments } from './playbooks-consent-planner.mjs';

export function buildConsentPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentPlannerWorkspace(workspaceName);
  const policies = createConsentPlannerPolicies();
  return {
    workspace,
    summary: summarizeConsentPlannerWorkspace(workspace),
    narratives: createConsentPlannerNarratives(workspace),
    coverage: createConsentPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentPlannerPolicies(policies),
    validation: validateConsentPlannerPolicies(policies),
    escalationDeck: createConsentPlannerEscalationDeck(policies),
    analytics: {
      timeline: createConsentPlannerAnalyticsTimeline(),
      forecast: createConsentPlannerForecastEnvelope(),
      exceptions: createConsentPlannerExceptionLedger(),
      summary: summarizeConsentPlannerAnalytics()
    },
    operations: {
      board: createConsentPlannerOperationsBoard(),
      checklist: createConsentPlannerShiftChecklist(),
      incidents: createConsentPlannerIncidentDeck()
    },
    reporting: {
      cards: createConsentPlannerReportCards(),
      packets: createConsentPlannerReviewPackets(),
      summary: summarizeConsentPlannerReporting()
    },
    audit: {
      trail: createConsentPlannerAuditTrail(),
      manifest: createConsentPlannerEvidenceManifest(),
      attestation: createConsentPlannerReadinessAttestation()
    },
    playbooks: createConsentPlannerPlaybooks(),
    decisions: createConsentPlannerDecisionDeck(),
    escalationMoments: createConsentPlannerEscalationMoments()
  };
}

export function createConsentPlannerReadinessBoard(snapshot = buildConsentPlannerSnapshot()) {
  return [
    { id: 'consent-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentPlannerApiDocument(snapshot = buildConsentPlannerSnapshot()) {
  return {
    id: 'consent-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-planner/overview' },
      { method: 'GET', path: '/api/consent-planner/reporting' },
      { method: 'POST', path: '/api/consent-planner/validate' },
      { method: 'GET', path: '/api/consent-planner/audit' }
    ],
    readiness: createConsentPlannerReadinessBoard(snapshot)
  };
}

export function createConsentPlannerRouteSummary(snapshot = buildConsentPlannerSnapshot()) {
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

