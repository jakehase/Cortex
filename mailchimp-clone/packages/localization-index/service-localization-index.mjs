import { createLocalizationIndexWorkspace, summarizeLocalizationIndexWorkspace, createLocalizationIndexNarratives, createLocalizationIndexCoverageGrid } from './domain-localization-index.mjs';
import { createLocalizationIndexPolicies, validateLocalizationIndexPolicies, summarizeLocalizationIndexPolicies, createLocalizationIndexEscalationDeck } from './policies-localization-index.mjs';
import { createLocalizationIndexAnalyticsTimeline, createLocalizationIndexForecastEnvelope, createLocalizationIndexExceptionLedger, summarizeLocalizationIndexAnalytics } from './analytics-localization-index.mjs';
import { createLocalizationIndexOperationsBoard, createLocalizationIndexShiftChecklist, createLocalizationIndexIncidentDeck } from './operations-localization-index.mjs';
import { createLocalizationIndexReportCards, createLocalizationIndexReviewPackets, summarizeLocalizationIndexReporting } from './reporting-localization-index.mjs';
import { createLocalizationIndexAuditTrail, createLocalizationIndexEvidenceManifest, createLocalizationIndexReadinessAttestation } from './audit-localization-index.mjs';
import { createLocalizationIndexPlaybooks, createLocalizationIndexDecisionDeck, createLocalizationIndexEscalationMoments } from './playbooks-localization-index.mjs';

export function buildLocalizationIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationIndexWorkspace(workspaceName);
  const policies = createLocalizationIndexPolicies();
  return {
    workspace,
    summary: summarizeLocalizationIndexWorkspace(workspace),
    narratives: createLocalizationIndexNarratives(workspace),
    coverage: createLocalizationIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationIndexPolicies(policies),
    validation: validateLocalizationIndexPolicies(policies),
    escalationDeck: createLocalizationIndexEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationIndexAnalyticsTimeline(),
      forecast: createLocalizationIndexForecastEnvelope(),
      exceptions: createLocalizationIndexExceptionLedger(),
      summary: summarizeLocalizationIndexAnalytics()
    },
    operations: {
      board: createLocalizationIndexOperationsBoard(),
      checklist: createLocalizationIndexShiftChecklist(),
      incidents: createLocalizationIndexIncidentDeck()
    },
    reporting: {
      cards: createLocalizationIndexReportCards(),
      packets: createLocalizationIndexReviewPackets(),
      summary: summarizeLocalizationIndexReporting()
    },
    audit: {
      trail: createLocalizationIndexAuditTrail(),
      manifest: createLocalizationIndexEvidenceManifest(),
      attestation: createLocalizationIndexReadinessAttestation()
    },
    playbooks: createLocalizationIndexPlaybooks(),
    decisions: createLocalizationIndexDecisionDeck(),
    escalationMoments: createLocalizationIndexEscalationMoments()
  };
}

export function createLocalizationIndexReadinessBoard(snapshot = buildLocalizationIndexSnapshot()) {
  return [
    { id: 'localization-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationIndexApiDocument(snapshot = buildLocalizationIndexSnapshot()) {
  return {
    id: 'localization-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-index/overview' },
      { method: 'GET', path: '/api/localization-index/reporting' },
      { method: 'POST', path: '/api/localization-index/validate' },
      { method: 'GET', path: '/api/localization-index/audit' }
    ],
    readiness: createLocalizationIndexReadinessBoard(snapshot)
  };
}

export function createLocalizationIndexRouteSummary(snapshot = buildLocalizationIndexSnapshot()) {
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

