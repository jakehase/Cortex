import { createAttributionIndexWorkspace, summarizeAttributionIndexWorkspace, createAttributionIndexNarratives, createAttributionIndexCoverageGrid } from './domain-attribution-index.mjs';
import { createAttributionIndexPolicies, validateAttributionIndexPolicies, summarizeAttributionIndexPolicies, createAttributionIndexEscalationDeck } from './policies-attribution-index.mjs';
import { createAttributionIndexAnalyticsTimeline, createAttributionIndexForecastEnvelope, createAttributionIndexExceptionLedger, summarizeAttributionIndexAnalytics } from './analytics-attribution-index.mjs';
import { createAttributionIndexOperationsBoard, createAttributionIndexShiftChecklist, createAttributionIndexIncidentDeck } from './operations-attribution-index.mjs';
import { createAttributionIndexReportCards, createAttributionIndexReviewPackets, summarizeAttributionIndexReporting } from './reporting-attribution-index.mjs';
import { createAttributionIndexAuditTrail, createAttributionIndexEvidenceManifest, createAttributionIndexReadinessAttestation } from './audit-attribution-index.mjs';
import { createAttributionIndexPlaybooks, createAttributionIndexDecisionDeck, createAttributionIndexEscalationMoments } from './playbooks-attribution-index.mjs';

export function buildAttributionIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionIndexWorkspace(workspaceName);
  const policies = createAttributionIndexPolicies();
  return {
    workspace,
    summary: summarizeAttributionIndexWorkspace(workspace),
    narratives: createAttributionIndexNarratives(workspace),
    coverage: createAttributionIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionIndexPolicies(policies),
    validation: validateAttributionIndexPolicies(policies),
    escalationDeck: createAttributionIndexEscalationDeck(policies),
    analytics: {
      timeline: createAttributionIndexAnalyticsTimeline(),
      forecast: createAttributionIndexForecastEnvelope(),
      exceptions: createAttributionIndexExceptionLedger(),
      summary: summarizeAttributionIndexAnalytics()
    },
    operations: {
      board: createAttributionIndexOperationsBoard(),
      checklist: createAttributionIndexShiftChecklist(),
      incidents: createAttributionIndexIncidentDeck()
    },
    reporting: {
      cards: createAttributionIndexReportCards(),
      packets: createAttributionIndexReviewPackets(),
      summary: summarizeAttributionIndexReporting()
    },
    audit: {
      trail: createAttributionIndexAuditTrail(),
      manifest: createAttributionIndexEvidenceManifest(),
      attestation: createAttributionIndexReadinessAttestation()
    },
    playbooks: createAttributionIndexPlaybooks(),
    decisions: createAttributionIndexDecisionDeck(),
    escalationMoments: createAttributionIndexEscalationMoments()
  };
}

export function createAttributionIndexReadinessBoard(snapshot = buildAttributionIndexSnapshot()) {
  return [
    { id: 'attribution-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionIndexApiDocument(snapshot = buildAttributionIndexSnapshot()) {
  return {
    id: 'attribution-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-index/overview' },
      { method: 'GET', path: '/api/attribution-index/reporting' },
      { method: 'POST', path: '/api/attribution-index/validate' },
      { method: 'GET', path: '/api/attribution-index/audit' }
    ],
    readiness: createAttributionIndexReadinessBoard(snapshot)
  };
}

export function createAttributionIndexRouteSummary(snapshot = buildAttributionIndexSnapshot()) {
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

