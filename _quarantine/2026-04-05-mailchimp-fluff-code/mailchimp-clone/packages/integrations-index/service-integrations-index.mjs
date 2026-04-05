import { createIntegrationsIndexWorkspace, summarizeIntegrationsIndexWorkspace, createIntegrationsIndexNarratives, createIntegrationsIndexCoverageGrid } from './domain-integrations-index.mjs';
import { createIntegrationsIndexPolicies, validateIntegrationsIndexPolicies, summarizeIntegrationsIndexPolicies, createIntegrationsIndexEscalationDeck } from './policies-integrations-index.mjs';
import { createIntegrationsIndexAnalyticsTimeline, createIntegrationsIndexForecastEnvelope, createIntegrationsIndexExceptionLedger, summarizeIntegrationsIndexAnalytics } from './analytics-integrations-index.mjs';
import { createIntegrationsIndexOperationsBoard, createIntegrationsIndexShiftChecklist, createIntegrationsIndexIncidentDeck } from './operations-integrations-index.mjs';
import { createIntegrationsIndexReportCards, createIntegrationsIndexReviewPackets, summarizeIntegrationsIndexReporting } from './reporting-integrations-index.mjs';
import { createIntegrationsIndexAuditTrail, createIntegrationsIndexEvidenceManifest, createIntegrationsIndexReadinessAttestation } from './audit-integrations-index.mjs';
import { createIntegrationsIndexPlaybooks, createIntegrationsIndexDecisionDeck, createIntegrationsIndexEscalationMoments } from './playbooks-integrations-index.mjs';

export function buildIntegrationsIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsIndexWorkspace(workspaceName);
  const policies = createIntegrationsIndexPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsIndexWorkspace(workspace),
    narratives: createIntegrationsIndexNarratives(workspace),
    coverage: createIntegrationsIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsIndexPolicies(policies),
    validation: validateIntegrationsIndexPolicies(policies),
    escalationDeck: createIntegrationsIndexEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsIndexAnalyticsTimeline(),
      forecast: createIntegrationsIndexForecastEnvelope(),
      exceptions: createIntegrationsIndexExceptionLedger(),
      summary: summarizeIntegrationsIndexAnalytics()
    },
    operations: {
      board: createIntegrationsIndexOperationsBoard(),
      checklist: createIntegrationsIndexShiftChecklist(),
      incidents: createIntegrationsIndexIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsIndexReportCards(),
      packets: createIntegrationsIndexReviewPackets(),
      summary: summarizeIntegrationsIndexReporting()
    },
    audit: {
      trail: createIntegrationsIndexAuditTrail(),
      manifest: createIntegrationsIndexEvidenceManifest(),
      attestation: createIntegrationsIndexReadinessAttestation()
    },
    playbooks: createIntegrationsIndexPlaybooks(),
    decisions: createIntegrationsIndexDecisionDeck(),
    escalationMoments: createIntegrationsIndexEscalationMoments()
  };
}

export function createIntegrationsIndexReadinessBoard(snapshot = buildIntegrationsIndexSnapshot()) {
  return [
    { id: 'integrations-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsIndexApiDocument(snapshot = buildIntegrationsIndexSnapshot()) {
  return {
    id: 'integrations-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-index/overview' },
      { method: 'GET', path: '/api/integrations-index/reporting' },
      { method: 'POST', path: '/api/integrations-index/validate' },
      { method: 'GET', path: '/api/integrations-index/audit' }
    ],
    readiness: createIntegrationsIndexReadinessBoard(snapshot)
  };
}

export function createIntegrationsIndexRouteSummary(snapshot = buildIntegrationsIndexSnapshot()) {
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

