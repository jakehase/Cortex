import { createDataIndexWorkspace, summarizeDataIndexWorkspace, createDataIndexNarratives, createDataIndexCoverageGrid } from './domain-data-index.mjs';
import { createDataIndexPolicies, validateDataIndexPolicies, summarizeDataIndexPolicies, createDataIndexEscalationDeck } from './policies-data-index.mjs';
import { createDataIndexAnalyticsTimeline, createDataIndexForecastEnvelope, createDataIndexExceptionLedger, summarizeDataIndexAnalytics } from './analytics-data-index.mjs';
import { createDataIndexOperationsBoard, createDataIndexShiftChecklist, createDataIndexIncidentDeck } from './operations-data-index.mjs';
import { createDataIndexReportCards, createDataIndexReviewPackets, summarizeDataIndexReporting } from './reporting-data-index.mjs';
import { createDataIndexAuditTrail, createDataIndexEvidenceManifest, createDataIndexReadinessAttestation } from './audit-data-index.mjs';
import { createDataIndexPlaybooks, createDataIndexDecisionDeck, createDataIndexEscalationMoments } from './playbooks-data-index.mjs';

export function buildDataIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataIndexWorkspace(workspaceName);
  const policies = createDataIndexPolicies();
  return {
    workspace,
    summary: summarizeDataIndexWorkspace(workspace),
    narratives: createDataIndexNarratives(workspace),
    coverage: createDataIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataIndexPolicies(policies),
    validation: validateDataIndexPolicies(policies),
    escalationDeck: createDataIndexEscalationDeck(policies),
    analytics: {
      timeline: createDataIndexAnalyticsTimeline(),
      forecast: createDataIndexForecastEnvelope(),
      exceptions: createDataIndexExceptionLedger(),
      summary: summarizeDataIndexAnalytics()
    },
    operations: {
      board: createDataIndexOperationsBoard(),
      checklist: createDataIndexShiftChecklist(),
      incidents: createDataIndexIncidentDeck()
    },
    reporting: {
      cards: createDataIndexReportCards(),
      packets: createDataIndexReviewPackets(),
      summary: summarizeDataIndexReporting()
    },
    audit: {
      trail: createDataIndexAuditTrail(),
      manifest: createDataIndexEvidenceManifest(),
      attestation: createDataIndexReadinessAttestation()
    },
    playbooks: createDataIndexPlaybooks(),
    decisions: createDataIndexDecisionDeck(),
    escalationMoments: createDataIndexEscalationMoments()
  };
}

export function createDataIndexReadinessBoard(snapshot = buildDataIndexSnapshot()) {
  return [
    { id: 'data-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataIndexApiDocument(snapshot = buildDataIndexSnapshot()) {
  return {
    id: 'data-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-index/overview' },
      { method: 'GET', path: '/api/data-index/reporting' },
      { method: 'POST', path: '/api/data-index/validate' },
      { method: 'GET', path: '/api/data-index/audit' }
    ],
    readiness: createDataIndexReadinessBoard(snapshot)
  };
}

export function createDataIndexRouteSummary(snapshot = buildDataIndexSnapshot()) {
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

