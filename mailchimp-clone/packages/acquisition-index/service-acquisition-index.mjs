import { createAcquisitionIndexWorkspace, summarizeAcquisitionIndexWorkspace, createAcquisitionIndexNarratives, createAcquisitionIndexCoverageGrid } from './domain-acquisition-index.mjs';
import { createAcquisitionIndexPolicies, validateAcquisitionIndexPolicies, summarizeAcquisitionIndexPolicies, createAcquisitionIndexEscalationDeck } from './policies-acquisition-index.mjs';
import { createAcquisitionIndexAnalyticsTimeline, createAcquisitionIndexForecastEnvelope, createAcquisitionIndexExceptionLedger, summarizeAcquisitionIndexAnalytics } from './analytics-acquisition-index.mjs';
import { createAcquisitionIndexOperationsBoard, createAcquisitionIndexShiftChecklist, createAcquisitionIndexIncidentDeck } from './operations-acquisition-index.mjs';
import { createAcquisitionIndexReportCards, createAcquisitionIndexReviewPackets, summarizeAcquisitionIndexReporting } from './reporting-acquisition-index.mjs';
import { createAcquisitionIndexAuditTrail, createAcquisitionIndexEvidenceManifest, createAcquisitionIndexReadinessAttestation } from './audit-acquisition-index.mjs';
import { createAcquisitionIndexPlaybooks, createAcquisitionIndexDecisionDeck, createAcquisitionIndexEscalationMoments } from './playbooks-acquisition-index.mjs';

export function buildAcquisitionIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionIndexWorkspace(workspaceName);
  const policies = createAcquisitionIndexPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionIndexWorkspace(workspace),
    narratives: createAcquisitionIndexNarratives(workspace),
    coverage: createAcquisitionIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionIndexPolicies(policies),
    validation: validateAcquisitionIndexPolicies(policies),
    escalationDeck: createAcquisitionIndexEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionIndexAnalyticsTimeline(),
      forecast: createAcquisitionIndexForecastEnvelope(),
      exceptions: createAcquisitionIndexExceptionLedger(),
      summary: summarizeAcquisitionIndexAnalytics()
    },
    operations: {
      board: createAcquisitionIndexOperationsBoard(),
      checklist: createAcquisitionIndexShiftChecklist(),
      incidents: createAcquisitionIndexIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionIndexReportCards(),
      packets: createAcquisitionIndexReviewPackets(),
      summary: summarizeAcquisitionIndexReporting()
    },
    audit: {
      trail: createAcquisitionIndexAuditTrail(),
      manifest: createAcquisitionIndexEvidenceManifest(),
      attestation: createAcquisitionIndexReadinessAttestation()
    },
    playbooks: createAcquisitionIndexPlaybooks(),
    decisions: createAcquisitionIndexDecisionDeck(),
    escalationMoments: createAcquisitionIndexEscalationMoments()
  };
}

export function createAcquisitionIndexReadinessBoard(snapshot = buildAcquisitionIndexSnapshot()) {
  return [
    { id: 'acquisition-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionIndexApiDocument(snapshot = buildAcquisitionIndexSnapshot()) {
  return {
    id: 'acquisition-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-index/overview' },
      { method: 'GET', path: '/api/acquisition-index/reporting' },
      { method: 'POST', path: '/api/acquisition-index/validate' },
      { method: 'GET', path: '/api/acquisition-index/audit' }
    ],
    readiness: createAcquisitionIndexReadinessBoard(snapshot)
  };
}

export function createAcquisitionIndexRouteSummary(snapshot = buildAcquisitionIndexSnapshot()) {
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

