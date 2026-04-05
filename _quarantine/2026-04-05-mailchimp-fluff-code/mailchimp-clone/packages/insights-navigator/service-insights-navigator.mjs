import { createInsightsNavigatorWorkspace, summarizeInsightsNavigatorWorkspace, createInsightsNavigatorNarratives, createInsightsNavigatorCoverageGrid } from './domain-insights-navigator.mjs';
import { createInsightsNavigatorPolicies, validateInsightsNavigatorPolicies, summarizeInsightsNavigatorPolicies, createInsightsNavigatorEscalationDeck } from './policies-insights-navigator.mjs';
import { createInsightsNavigatorAnalyticsTimeline, createInsightsNavigatorForecastEnvelope, createInsightsNavigatorExceptionLedger, summarizeInsightsNavigatorAnalytics } from './analytics-insights-navigator.mjs';
import { createInsightsNavigatorOperationsBoard, createInsightsNavigatorShiftChecklist, createInsightsNavigatorIncidentDeck } from './operations-insights-navigator.mjs';
import { createInsightsNavigatorReportCards, createInsightsNavigatorReviewPackets, summarizeInsightsNavigatorReporting } from './reporting-insights-navigator.mjs';
import { createInsightsNavigatorAuditTrail, createInsightsNavigatorEvidenceManifest, createInsightsNavigatorReadinessAttestation } from './audit-insights-navigator.mjs';
import { createInsightsNavigatorPlaybooks, createInsightsNavigatorDecisionDeck, createInsightsNavigatorEscalationMoments } from './playbooks-insights-navigator.mjs';

export function buildInsightsNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsNavigatorWorkspace(workspaceName);
  const policies = createInsightsNavigatorPolicies();
  return {
    workspace,
    summary: summarizeInsightsNavigatorWorkspace(workspace),
    narratives: createInsightsNavigatorNarratives(workspace),
    coverage: createInsightsNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsNavigatorPolicies(policies),
    validation: validateInsightsNavigatorPolicies(policies),
    escalationDeck: createInsightsNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createInsightsNavigatorAnalyticsTimeline(),
      forecast: createInsightsNavigatorForecastEnvelope(),
      exceptions: createInsightsNavigatorExceptionLedger(),
      summary: summarizeInsightsNavigatorAnalytics()
    },
    operations: {
      board: createInsightsNavigatorOperationsBoard(),
      checklist: createInsightsNavigatorShiftChecklist(),
      incidents: createInsightsNavigatorIncidentDeck()
    },
    reporting: {
      cards: createInsightsNavigatorReportCards(),
      packets: createInsightsNavigatorReviewPackets(),
      summary: summarizeInsightsNavigatorReporting()
    },
    audit: {
      trail: createInsightsNavigatorAuditTrail(),
      manifest: createInsightsNavigatorEvidenceManifest(),
      attestation: createInsightsNavigatorReadinessAttestation()
    },
    playbooks: createInsightsNavigatorPlaybooks(),
    decisions: createInsightsNavigatorDecisionDeck(),
    escalationMoments: createInsightsNavigatorEscalationMoments()
  };
}

export function createInsightsNavigatorReadinessBoard(snapshot = buildInsightsNavigatorSnapshot()) {
  return [
    { id: 'insights-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsNavigatorApiDocument(snapshot = buildInsightsNavigatorSnapshot()) {
  return {
    id: 'insights-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-navigator/overview' },
      { method: 'GET', path: '/api/insights-navigator/reporting' },
      { method: 'POST', path: '/api/insights-navigator/validate' },
      { method: 'GET', path: '/api/insights-navigator/audit' }
    ],
    readiness: createInsightsNavigatorReadinessBoard(snapshot)
  };
}

export function createInsightsNavigatorRouteSummary(snapshot = buildInsightsNavigatorSnapshot()) {
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

