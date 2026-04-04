import { createDataStudioWorkspace, summarizeDataStudioWorkspace, createDataStudioNarratives, createDataStudioCoverageGrid } from './domain-data-studio.mjs';
import { createDataStudioPolicies, validateDataStudioPolicies, summarizeDataStudioPolicies, createDataStudioEscalationDeck } from './policies-data-studio.mjs';
import { createDataStudioAnalyticsTimeline, createDataStudioForecastEnvelope, createDataStudioExceptionLedger, summarizeDataStudioAnalytics } from './analytics-data-studio.mjs';
import { createDataStudioOperationsBoard, createDataStudioShiftChecklist, createDataStudioIncidentDeck } from './operations-data-studio.mjs';
import { createDataStudioReportCards, createDataStudioReviewPackets, summarizeDataStudioReporting } from './reporting-data-studio.mjs';
import { createDataStudioAuditTrail, createDataStudioEvidenceManifest, createDataStudioReadinessAttestation } from './audit-data-studio.mjs';
import { createDataStudioPlaybooks, createDataStudioDecisionDeck, createDataStudioEscalationMoments } from './playbooks-data-studio.mjs';

export function buildDataStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataStudioWorkspace(workspaceName);
  const policies = createDataStudioPolicies();
  return {
    workspace,
    summary: summarizeDataStudioWorkspace(workspace),
    narratives: createDataStudioNarratives(workspace),
    coverage: createDataStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataStudioPolicies(policies),
    validation: validateDataStudioPolicies(policies),
    escalationDeck: createDataStudioEscalationDeck(policies),
    analytics: {
      timeline: createDataStudioAnalyticsTimeline(),
      forecast: createDataStudioForecastEnvelope(),
      exceptions: createDataStudioExceptionLedger(),
      summary: summarizeDataStudioAnalytics()
    },
    operations: {
      board: createDataStudioOperationsBoard(),
      checklist: createDataStudioShiftChecklist(),
      incidents: createDataStudioIncidentDeck()
    },
    reporting: {
      cards: createDataStudioReportCards(),
      packets: createDataStudioReviewPackets(),
      summary: summarizeDataStudioReporting()
    },
    audit: {
      trail: createDataStudioAuditTrail(),
      manifest: createDataStudioEvidenceManifest(),
      attestation: createDataStudioReadinessAttestation()
    },
    playbooks: createDataStudioPlaybooks(),
    decisions: createDataStudioDecisionDeck(),
    escalationMoments: createDataStudioEscalationMoments()
  };
}

export function createDataStudioReadinessBoard(snapshot = buildDataStudioSnapshot()) {
  return [
    { id: 'data-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataStudioApiDocument(snapshot = buildDataStudioSnapshot()) {
  return {
    id: 'data-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-studio/overview' },
      { method: 'GET', path: '/api/data-studio/reporting' },
      { method: 'POST', path: '/api/data-studio/validate' },
      { method: 'GET', path: '/api/data-studio/audit' }
    ],
    readiness: createDataStudioReadinessBoard(snapshot)
  };
}

export function createDataStudioRouteSummary(snapshot = buildDataStudioSnapshot()) {
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

