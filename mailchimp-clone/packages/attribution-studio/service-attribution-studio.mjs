import { createAttributionStudioWorkspace, summarizeAttributionStudioWorkspace, createAttributionStudioNarratives, createAttributionStudioCoverageGrid } from './domain-attribution-studio.mjs';
import { createAttributionStudioPolicies, validateAttributionStudioPolicies, summarizeAttributionStudioPolicies, createAttributionStudioEscalationDeck } from './policies-attribution-studio.mjs';
import { createAttributionStudioAnalyticsTimeline, createAttributionStudioForecastEnvelope, createAttributionStudioExceptionLedger, summarizeAttributionStudioAnalytics } from './analytics-attribution-studio.mjs';
import { createAttributionStudioOperationsBoard, createAttributionStudioShiftChecklist, createAttributionStudioIncidentDeck } from './operations-attribution-studio.mjs';
import { createAttributionStudioReportCards, createAttributionStudioReviewPackets, summarizeAttributionStudioReporting } from './reporting-attribution-studio.mjs';
import { createAttributionStudioAuditTrail, createAttributionStudioEvidenceManifest, createAttributionStudioReadinessAttestation } from './audit-attribution-studio.mjs';
import { createAttributionStudioPlaybooks, createAttributionStudioDecisionDeck, createAttributionStudioEscalationMoments } from './playbooks-attribution-studio.mjs';

export function buildAttributionStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionStudioWorkspace(workspaceName);
  const policies = createAttributionStudioPolicies();
  return {
    workspace,
    summary: summarizeAttributionStudioWorkspace(workspace),
    narratives: createAttributionStudioNarratives(workspace),
    coverage: createAttributionStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionStudioPolicies(policies),
    validation: validateAttributionStudioPolicies(policies),
    escalationDeck: createAttributionStudioEscalationDeck(policies),
    analytics: {
      timeline: createAttributionStudioAnalyticsTimeline(),
      forecast: createAttributionStudioForecastEnvelope(),
      exceptions: createAttributionStudioExceptionLedger(),
      summary: summarizeAttributionStudioAnalytics()
    },
    operations: {
      board: createAttributionStudioOperationsBoard(),
      checklist: createAttributionStudioShiftChecklist(),
      incidents: createAttributionStudioIncidentDeck()
    },
    reporting: {
      cards: createAttributionStudioReportCards(),
      packets: createAttributionStudioReviewPackets(),
      summary: summarizeAttributionStudioReporting()
    },
    audit: {
      trail: createAttributionStudioAuditTrail(),
      manifest: createAttributionStudioEvidenceManifest(),
      attestation: createAttributionStudioReadinessAttestation()
    },
    playbooks: createAttributionStudioPlaybooks(),
    decisions: createAttributionStudioDecisionDeck(),
    escalationMoments: createAttributionStudioEscalationMoments()
  };
}

export function createAttributionStudioReadinessBoard(snapshot = buildAttributionStudioSnapshot()) {
  return [
    { id: 'attribution-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionStudioApiDocument(snapshot = buildAttributionStudioSnapshot()) {
  return {
    id: 'attribution-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-studio/overview' },
      { method: 'GET', path: '/api/attribution-studio/reporting' },
      { method: 'POST', path: '/api/attribution-studio/validate' },
      { method: 'GET', path: '/api/attribution-studio/audit' }
    ],
    readiness: createAttributionStudioReadinessBoard(snapshot)
  };
}

export function createAttributionStudioRouteSummary(snapshot = buildAttributionStudioSnapshot()) {
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

