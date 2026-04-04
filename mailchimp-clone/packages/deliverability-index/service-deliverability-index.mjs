import { createDeliverabilityIndexWorkspace, summarizeDeliverabilityIndexWorkspace, createDeliverabilityIndexNarratives, createDeliverabilityIndexCoverageGrid } from './domain-deliverability-index.mjs';
import { createDeliverabilityIndexPolicies, validateDeliverabilityIndexPolicies, summarizeDeliverabilityIndexPolicies, createDeliverabilityIndexEscalationDeck } from './policies-deliverability-index.mjs';
import { createDeliverabilityIndexAnalyticsTimeline, createDeliverabilityIndexForecastEnvelope, createDeliverabilityIndexExceptionLedger, summarizeDeliverabilityIndexAnalytics } from './analytics-deliverability-index.mjs';
import { createDeliverabilityIndexOperationsBoard, createDeliverabilityIndexShiftChecklist, createDeliverabilityIndexIncidentDeck } from './operations-deliverability-index.mjs';
import { createDeliverabilityIndexReportCards, createDeliverabilityIndexReviewPackets, summarizeDeliverabilityIndexReporting } from './reporting-deliverability-index.mjs';
import { createDeliverabilityIndexAuditTrail, createDeliverabilityIndexEvidenceManifest, createDeliverabilityIndexReadinessAttestation } from './audit-deliverability-index.mjs';
import { createDeliverabilityIndexPlaybooks, createDeliverabilityIndexDecisionDeck, createDeliverabilityIndexEscalationMoments } from './playbooks-deliverability-index.mjs';

export function buildDeliverabilityIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityIndexWorkspace(workspaceName);
  const policies = createDeliverabilityIndexPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityIndexWorkspace(workspace),
    narratives: createDeliverabilityIndexNarratives(workspace),
    coverage: createDeliverabilityIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityIndexPolicies(policies),
    validation: validateDeliverabilityIndexPolicies(policies),
    escalationDeck: createDeliverabilityIndexEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityIndexAnalyticsTimeline(),
      forecast: createDeliverabilityIndexForecastEnvelope(),
      exceptions: createDeliverabilityIndexExceptionLedger(),
      summary: summarizeDeliverabilityIndexAnalytics()
    },
    operations: {
      board: createDeliverabilityIndexOperationsBoard(),
      checklist: createDeliverabilityIndexShiftChecklist(),
      incidents: createDeliverabilityIndexIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityIndexReportCards(),
      packets: createDeliverabilityIndexReviewPackets(),
      summary: summarizeDeliverabilityIndexReporting()
    },
    audit: {
      trail: createDeliverabilityIndexAuditTrail(),
      manifest: createDeliverabilityIndexEvidenceManifest(),
      attestation: createDeliverabilityIndexReadinessAttestation()
    },
    playbooks: createDeliverabilityIndexPlaybooks(),
    decisions: createDeliverabilityIndexDecisionDeck(),
    escalationMoments: createDeliverabilityIndexEscalationMoments()
  };
}

export function createDeliverabilityIndexReadinessBoard(snapshot = buildDeliverabilityIndexSnapshot()) {
  return [
    { id: 'deliverability-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityIndexApiDocument(snapshot = buildDeliverabilityIndexSnapshot()) {
  return {
    id: 'deliverability-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-index/overview' },
      { method: 'GET', path: '/api/deliverability-index/reporting' },
      { method: 'POST', path: '/api/deliverability-index/validate' },
      { method: 'GET', path: '/api/deliverability-index/audit' }
    ],
    readiness: createDeliverabilityIndexReadinessBoard(snapshot)
  };
}

export function createDeliverabilityIndexRouteSummary(snapshot = buildDeliverabilityIndexSnapshot()) {
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

