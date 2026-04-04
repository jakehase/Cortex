import { createAudienceIndexWorkspace, summarizeAudienceIndexWorkspace, createAudienceIndexNarratives, createAudienceIndexCoverageGrid } from './domain-audience-index.mjs';
import { createAudienceIndexPolicies, validateAudienceIndexPolicies, summarizeAudienceIndexPolicies, createAudienceIndexEscalationDeck } from './policies-audience-index.mjs';
import { createAudienceIndexAnalyticsTimeline, createAudienceIndexForecastEnvelope, createAudienceIndexExceptionLedger, summarizeAudienceIndexAnalytics } from './analytics-audience-index.mjs';
import { createAudienceIndexOperationsBoard, createAudienceIndexShiftChecklist, createAudienceIndexIncidentDeck } from './operations-audience-index.mjs';
import { createAudienceIndexReportCards, createAudienceIndexReviewPackets, summarizeAudienceIndexReporting } from './reporting-audience-index.mjs';
import { createAudienceIndexAuditTrail, createAudienceIndexEvidenceManifest, createAudienceIndexReadinessAttestation } from './audit-audience-index.mjs';
import { createAudienceIndexPlaybooks, createAudienceIndexDecisionDeck, createAudienceIndexEscalationMoments } from './playbooks-audience-index.mjs';

export function buildAudienceIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceIndexWorkspace(workspaceName);
  const policies = createAudienceIndexPolicies();
  return {
    workspace,
    summary: summarizeAudienceIndexWorkspace(workspace),
    narratives: createAudienceIndexNarratives(workspace),
    coverage: createAudienceIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceIndexPolicies(policies),
    validation: validateAudienceIndexPolicies(policies),
    escalationDeck: createAudienceIndexEscalationDeck(policies),
    analytics: {
      timeline: createAudienceIndexAnalyticsTimeline(),
      forecast: createAudienceIndexForecastEnvelope(),
      exceptions: createAudienceIndexExceptionLedger(),
      summary: summarizeAudienceIndexAnalytics()
    },
    operations: {
      board: createAudienceIndexOperationsBoard(),
      checklist: createAudienceIndexShiftChecklist(),
      incidents: createAudienceIndexIncidentDeck()
    },
    reporting: {
      cards: createAudienceIndexReportCards(),
      packets: createAudienceIndexReviewPackets(),
      summary: summarizeAudienceIndexReporting()
    },
    audit: {
      trail: createAudienceIndexAuditTrail(),
      manifest: createAudienceIndexEvidenceManifest(),
      attestation: createAudienceIndexReadinessAttestation()
    },
    playbooks: createAudienceIndexPlaybooks(),
    decisions: createAudienceIndexDecisionDeck(),
    escalationMoments: createAudienceIndexEscalationMoments()
  };
}

export function createAudienceIndexReadinessBoard(snapshot = buildAudienceIndexSnapshot()) {
  return [
    { id: 'audience-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceIndexApiDocument(snapshot = buildAudienceIndexSnapshot()) {
  return {
    id: 'audience-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-index/overview' },
      { method: 'GET', path: '/api/audience-index/reporting' },
      { method: 'POST', path: '/api/audience-index/validate' },
      { method: 'GET', path: '/api/audience-index/audit' }
    ],
    readiness: createAudienceIndexReadinessBoard(snapshot)
  };
}

export function createAudienceIndexRouteSummary(snapshot = buildAudienceIndexSnapshot()) {
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

