import { createInsightsStudioWorkspace, summarizeInsightsStudioWorkspace, createInsightsStudioNarratives, createInsightsStudioCoverageGrid } from './domain-insights-studio.mjs';
import { createInsightsStudioPolicies, validateInsightsStudioPolicies, summarizeInsightsStudioPolicies, createInsightsStudioEscalationDeck } from './policies-insights-studio.mjs';
import { createInsightsStudioAnalyticsTimeline, createInsightsStudioForecastEnvelope, createInsightsStudioExceptionLedger, summarizeInsightsStudioAnalytics } from './analytics-insights-studio.mjs';
import { createInsightsStudioOperationsBoard, createInsightsStudioShiftChecklist, createInsightsStudioIncidentDeck } from './operations-insights-studio.mjs';
import { createInsightsStudioReportCards, createInsightsStudioReviewPackets, summarizeInsightsStudioReporting } from './reporting-insights-studio.mjs';
import { createInsightsStudioAuditTrail, createInsightsStudioEvidenceManifest, createInsightsStudioReadinessAttestation } from './audit-insights-studio.mjs';
import { createInsightsStudioPlaybooks, createInsightsStudioDecisionDeck, createInsightsStudioEscalationMoments } from './playbooks-insights-studio.mjs';

export function buildInsightsStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsStudioWorkspace(workspaceName);
  const policies = createInsightsStudioPolicies();
  return {
    workspace,
    summary: summarizeInsightsStudioWorkspace(workspace),
    narratives: createInsightsStudioNarratives(workspace),
    coverage: createInsightsStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsStudioPolicies(policies),
    validation: validateInsightsStudioPolicies(policies),
    escalationDeck: createInsightsStudioEscalationDeck(policies),
    analytics: {
      timeline: createInsightsStudioAnalyticsTimeline(),
      forecast: createInsightsStudioForecastEnvelope(),
      exceptions: createInsightsStudioExceptionLedger(),
      summary: summarizeInsightsStudioAnalytics()
    },
    operations: {
      board: createInsightsStudioOperationsBoard(),
      checklist: createInsightsStudioShiftChecklist(),
      incidents: createInsightsStudioIncidentDeck()
    },
    reporting: {
      cards: createInsightsStudioReportCards(),
      packets: createInsightsStudioReviewPackets(),
      summary: summarizeInsightsStudioReporting()
    },
    audit: {
      trail: createInsightsStudioAuditTrail(),
      manifest: createInsightsStudioEvidenceManifest(),
      attestation: createInsightsStudioReadinessAttestation()
    },
    playbooks: createInsightsStudioPlaybooks(),
    decisions: createInsightsStudioDecisionDeck(),
    escalationMoments: createInsightsStudioEscalationMoments()
  };
}

export function createInsightsStudioReadinessBoard(snapshot = buildInsightsStudioSnapshot()) {
  return [
    { id: 'insights-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsStudioApiDocument(snapshot = buildInsightsStudioSnapshot()) {
  return {
    id: 'insights-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-studio/overview' },
      { method: 'GET', path: '/api/insights-studio/reporting' },
      { method: 'POST', path: '/api/insights-studio/validate' },
      { method: 'GET', path: '/api/insights-studio/audit' }
    ],
    readiness: createInsightsStudioReadinessBoard(snapshot)
  };
}

export function createInsightsStudioRouteSummary(snapshot = buildInsightsStudioSnapshot()) {
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

