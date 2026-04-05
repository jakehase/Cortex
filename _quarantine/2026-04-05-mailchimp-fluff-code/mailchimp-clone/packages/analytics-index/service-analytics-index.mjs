import { createAnalyticsIndexWorkspace, summarizeAnalyticsIndexWorkspace, createAnalyticsIndexNarratives, createAnalyticsIndexCoverageGrid } from './domain-analytics-index.mjs';
import { createAnalyticsIndexPolicies, validateAnalyticsIndexPolicies, summarizeAnalyticsIndexPolicies, createAnalyticsIndexEscalationDeck } from './policies-analytics-index.mjs';
import { createAnalyticsIndexAnalyticsTimeline, createAnalyticsIndexForecastEnvelope, createAnalyticsIndexExceptionLedger, summarizeAnalyticsIndexAnalytics } from './analytics-analytics-index.mjs';
import { createAnalyticsIndexOperationsBoard, createAnalyticsIndexShiftChecklist, createAnalyticsIndexIncidentDeck } from './operations-analytics-index.mjs';
import { createAnalyticsIndexReportCards, createAnalyticsIndexReviewPackets, summarizeAnalyticsIndexReporting } from './reporting-analytics-index.mjs';
import { createAnalyticsIndexAuditTrail, createAnalyticsIndexEvidenceManifest, createAnalyticsIndexReadinessAttestation } from './audit-analytics-index.mjs';
import { createAnalyticsIndexPlaybooks, createAnalyticsIndexDecisionDeck, createAnalyticsIndexEscalationMoments } from './playbooks-analytics-index.mjs';

export function buildAnalyticsIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsIndexWorkspace(workspaceName);
  const policies = createAnalyticsIndexPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsIndexWorkspace(workspace),
    narratives: createAnalyticsIndexNarratives(workspace),
    coverage: createAnalyticsIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsIndexPolicies(policies),
    validation: validateAnalyticsIndexPolicies(policies),
    escalationDeck: createAnalyticsIndexEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsIndexAnalyticsTimeline(),
      forecast: createAnalyticsIndexForecastEnvelope(),
      exceptions: createAnalyticsIndexExceptionLedger(),
      summary: summarizeAnalyticsIndexAnalytics()
    },
    operations: {
      board: createAnalyticsIndexOperationsBoard(),
      checklist: createAnalyticsIndexShiftChecklist(),
      incidents: createAnalyticsIndexIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsIndexReportCards(),
      packets: createAnalyticsIndexReviewPackets(),
      summary: summarizeAnalyticsIndexReporting()
    },
    audit: {
      trail: createAnalyticsIndexAuditTrail(),
      manifest: createAnalyticsIndexEvidenceManifest(),
      attestation: createAnalyticsIndexReadinessAttestation()
    },
    playbooks: createAnalyticsIndexPlaybooks(),
    decisions: createAnalyticsIndexDecisionDeck(),
    escalationMoments: createAnalyticsIndexEscalationMoments()
  };
}

export function createAnalyticsIndexReadinessBoard(snapshot = buildAnalyticsIndexSnapshot()) {
  return [
    { id: 'analytics-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsIndexApiDocument(snapshot = buildAnalyticsIndexSnapshot()) {
  return {
    id: 'analytics-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-index/overview' },
      { method: 'GET', path: '/api/analytics-index/reporting' },
      { method: 'POST', path: '/api/analytics-index/validate' },
      { method: 'GET', path: '/api/analytics-index/audit' }
    ],
    readiness: createAnalyticsIndexReadinessBoard(snapshot)
  };
}

export function createAnalyticsIndexRouteSummary(snapshot = buildAnalyticsIndexSnapshot()) {
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

