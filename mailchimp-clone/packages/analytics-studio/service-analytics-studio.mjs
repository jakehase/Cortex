import { createAnalyticsStudioWorkspace, summarizeAnalyticsStudioWorkspace, createAnalyticsStudioNarratives, createAnalyticsStudioCoverageGrid } from './domain-analytics-studio.mjs';
import { createAnalyticsStudioPolicies, validateAnalyticsStudioPolicies, summarizeAnalyticsStudioPolicies, createAnalyticsStudioEscalationDeck } from './policies-analytics-studio.mjs';
import { createAnalyticsStudioAnalyticsTimeline, createAnalyticsStudioForecastEnvelope, createAnalyticsStudioExceptionLedger, summarizeAnalyticsStudioAnalytics } from './analytics-analytics-studio.mjs';
import { createAnalyticsStudioOperationsBoard, createAnalyticsStudioShiftChecklist, createAnalyticsStudioIncidentDeck } from './operations-analytics-studio.mjs';
import { createAnalyticsStudioReportCards, createAnalyticsStudioReviewPackets, summarizeAnalyticsStudioReporting } from './reporting-analytics-studio.mjs';
import { createAnalyticsStudioAuditTrail, createAnalyticsStudioEvidenceManifest, createAnalyticsStudioReadinessAttestation } from './audit-analytics-studio.mjs';
import { createAnalyticsStudioPlaybooks, createAnalyticsStudioDecisionDeck, createAnalyticsStudioEscalationMoments } from './playbooks-analytics-studio.mjs';

export function buildAnalyticsStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsStudioWorkspace(workspaceName);
  const policies = createAnalyticsStudioPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsStudioWorkspace(workspace),
    narratives: createAnalyticsStudioNarratives(workspace),
    coverage: createAnalyticsStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsStudioPolicies(policies),
    validation: validateAnalyticsStudioPolicies(policies),
    escalationDeck: createAnalyticsStudioEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsStudioAnalyticsTimeline(),
      forecast: createAnalyticsStudioForecastEnvelope(),
      exceptions: createAnalyticsStudioExceptionLedger(),
      summary: summarizeAnalyticsStudioAnalytics()
    },
    operations: {
      board: createAnalyticsStudioOperationsBoard(),
      checklist: createAnalyticsStudioShiftChecklist(),
      incidents: createAnalyticsStudioIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsStudioReportCards(),
      packets: createAnalyticsStudioReviewPackets(),
      summary: summarizeAnalyticsStudioReporting()
    },
    audit: {
      trail: createAnalyticsStudioAuditTrail(),
      manifest: createAnalyticsStudioEvidenceManifest(),
      attestation: createAnalyticsStudioReadinessAttestation()
    },
    playbooks: createAnalyticsStudioPlaybooks(),
    decisions: createAnalyticsStudioDecisionDeck(),
    escalationMoments: createAnalyticsStudioEscalationMoments()
  };
}

export function createAnalyticsStudioReadinessBoard(snapshot = buildAnalyticsStudioSnapshot()) {
  return [
    { id: 'analytics-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsStudioApiDocument(snapshot = buildAnalyticsStudioSnapshot()) {
  return {
    id: 'analytics-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-studio/overview' },
      { method: 'GET', path: '/api/analytics-studio/reporting' },
      { method: 'POST', path: '/api/analytics-studio/validate' },
      { method: 'GET', path: '/api/analytics-studio/audit' }
    ],
    readiness: createAnalyticsStudioReadinessBoard(snapshot)
  };
}

export function createAnalyticsStudioRouteSummary(snapshot = buildAnalyticsStudioSnapshot()) {
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

