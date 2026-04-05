import { createInsightsIndexWorkspace, summarizeInsightsIndexWorkspace, createInsightsIndexNarratives, createInsightsIndexCoverageGrid } from './domain-insights-index.mjs';
import { createInsightsIndexPolicies, validateInsightsIndexPolicies, summarizeInsightsIndexPolicies, createInsightsIndexEscalationDeck } from './policies-insights-index.mjs';
import { createInsightsIndexAnalyticsTimeline, createInsightsIndexForecastEnvelope, createInsightsIndexExceptionLedger, summarizeInsightsIndexAnalytics } from './analytics-insights-index.mjs';
import { createInsightsIndexOperationsBoard, createInsightsIndexShiftChecklist, createInsightsIndexIncidentDeck } from './operations-insights-index.mjs';
import { createInsightsIndexReportCards, createInsightsIndexReviewPackets, summarizeInsightsIndexReporting } from './reporting-insights-index.mjs';
import { createInsightsIndexAuditTrail, createInsightsIndexEvidenceManifest, createInsightsIndexReadinessAttestation } from './audit-insights-index.mjs';
import { createInsightsIndexPlaybooks, createInsightsIndexDecisionDeck, createInsightsIndexEscalationMoments } from './playbooks-insights-index.mjs';

export function buildInsightsIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsIndexWorkspace(workspaceName);
  const policies = createInsightsIndexPolicies();
  return {
    workspace,
    summary: summarizeInsightsIndexWorkspace(workspace),
    narratives: createInsightsIndexNarratives(workspace),
    coverage: createInsightsIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsIndexPolicies(policies),
    validation: validateInsightsIndexPolicies(policies),
    escalationDeck: createInsightsIndexEscalationDeck(policies),
    analytics: {
      timeline: createInsightsIndexAnalyticsTimeline(),
      forecast: createInsightsIndexForecastEnvelope(),
      exceptions: createInsightsIndexExceptionLedger(),
      summary: summarizeInsightsIndexAnalytics()
    },
    operations: {
      board: createInsightsIndexOperationsBoard(),
      checklist: createInsightsIndexShiftChecklist(),
      incidents: createInsightsIndexIncidentDeck()
    },
    reporting: {
      cards: createInsightsIndexReportCards(),
      packets: createInsightsIndexReviewPackets(),
      summary: summarizeInsightsIndexReporting()
    },
    audit: {
      trail: createInsightsIndexAuditTrail(),
      manifest: createInsightsIndexEvidenceManifest(),
      attestation: createInsightsIndexReadinessAttestation()
    },
    playbooks: createInsightsIndexPlaybooks(),
    decisions: createInsightsIndexDecisionDeck(),
    escalationMoments: createInsightsIndexEscalationMoments()
  };
}

export function createInsightsIndexReadinessBoard(snapshot = buildInsightsIndexSnapshot()) {
  return [
    { id: 'insights-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsIndexApiDocument(snapshot = buildInsightsIndexSnapshot()) {
  return {
    id: 'insights-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-index/overview' },
      { method: 'GET', path: '/api/insights-index/reporting' },
      { method: 'POST', path: '/api/insights-index/validate' },
      { method: 'GET', path: '/api/insights-index/audit' }
    ],
    readiness: createInsightsIndexReadinessBoard(snapshot)
  };
}

export function createInsightsIndexRouteSummary(snapshot = buildInsightsIndexSnapshot()) {
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

