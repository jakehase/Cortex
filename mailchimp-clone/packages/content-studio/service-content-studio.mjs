import { createContentStudioWorkspace, summarizeContentStudioWorkspace, createContentStudioNarratives, createContentStudioCoverageGrid } from './domain-content-studio.mjs';
import { createContentStudioPolicies, validateContentStudioPolicies, summarizeContentStudioPolicies, createContentStudioEscalationDeck } from './policies-content-studio.mjs';
import { createContentStudioAnalyticsTimeline, createContentStudioForecastEnvelope, createContentStudioExceptionLedger, summarizeContentStudioAnalytics } from './analytics-content-studio.mjs';
import { createContentStudioOperationsBoard, createContentStudioShiftChecklist, createContentStudioIncidentDeck } from './operations-content-studio.mjs';
import { createContentStudioReportCards, createContentStudioReviewPackets, summarizeContentStudioReporting } from './reporting-content-studio.mjs';
import { createContentStudioAuditTrail, createContentStudioEvidenceManifest, createContentStudioReadinessAttestation } from './audit-content-studio.mjs';
import { createContentStudioPlaybooks, createContentStudioDecisionDeck, createContentStudioEscalationMoments } from './playbooks-content-studio.mjs';

export function buildContentStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentStudioWorkspace(workspaceName);
  const policies = createContentStudioPolicies();
  return {
    workspace,
    summary: summarizeContentStudioWorkspace(workspace),
    narratives: createContentStudioNarratives(workspace),
    coverage: createContentStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentStudioPolicies(policies),
    validation: validateContentStudioPolicies(policies),
    escalationDeck: createContentStudioEscalationDeck(policies),
    analytics: {
      timeline: createContentStudioAnalyticsTimeline(),
      forecast: createContentStudioForecastEnvelope(),
      exceptions: createContentStudioExceptionLedger(),
      summary: summarizeContentStudioAnalytics()
    },
    operations: {
      board: createContentStudioOperationsBoard(),
      checklist: createContentStudioShiftChecklist(),
      incidents: createContentStudioIncidentDeck()
    },
    reporting: {
      cards: createContentStudioReportCards(),
      packets: createContentStudioReviewPackets(),
      summary: summarizeContentStudioReporting()
    },
    audit: {
      trail: createContentStudioAuditTrail(),
      manifest: createContentStudioEvidenceManifest(),
      attestation: createContentStudioReadinessAttestation()
    },
    playbooks: createContentStudioPlaybooks(),
    decisions: createContentStudioDecisionDeck(),
    escalationMoments: createContentStudioEscalationMoments()
  };
}

export function createContentStudioReadinessBoard(snapshot = buildContentStudioSnapshot()) {
  return [
    { id: 'content-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentStudioApiDocument(snapshot = buildContentStudioSnapshot()) {
  return {
    id: 'content-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-studio/overview' },
      { method: 'GET', path: '/api/content-studio/reporting' },
      { method: 'POST', path: '/api/content-studio/validate' },
      { method: 'GET', path: '/api/content-studio/audit' }
    ],
    readiness: createContentStudioReadinessBoard(snapshot)
  };
}

export function createContentStudioRouteSummary(snapshot = buildContentStudioSnapshot()) {
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

