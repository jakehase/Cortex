import { createCreativeStudioWorkspace, summarizeCreativeStudioWorkspace, createCreativeStudioNarratives, createCreativeStudioCoverageGrid } from './domain-creative-studio.mjs';
import { createCreativeStudioPolicies, validateCreativeStudioPolicies, summarizeCreativeStudioPolicies, createCreativeStudioEscalationDeck } from './policies-creative-studio.mjs';
import { createCreativeStudioAnalyticsTimeline, createCreativeStudioForecastEnvelope, createCreativeStudioExceptionLedger, summarizeCreativeStudioAnalytics } from './analytics-creative-studio.mjs';
import { createCreativeStudioOperationsBoard, createCreativeStudioShiftChecklist, createCreativeStudioIncidentDeck } from './operations-creative-studio.mjs';
import { createCreativeStudioReportCards, createCreativeStudioReviewPackets, summarizeCreativeStudioReporting } from './reporting-creative-studio.mjs';
import { createCreativeStudioAuditTrail, createCreativeStudioEvidenceManifest, createCreativeStudioReadinessAttestation } from './audit-creative-studio.mjs';
import { createCreativeStudioPlaybooks, createCreativeStudioDecisionDeck, createCreativeStudioEscalationMoments } from './playbooks-creative-studio.mjs';

export function buildCreativeStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeStudioWorkspace(workspaceName);
  const policies = createCreativeStudioPolicies();
  return {
    workspace,
    summary: summarizeCreativeStudioWorkspace(workspace),
    narratives: createCreativeStudioNarratives(workspace),
    coverage: createCreativeStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeStudioPolicies(policies),
    validation: validateCreativeStudioPolicies(policies),
    escalationDeck: createCreativeStudioEscalationDeck(policies),
    analytics: {
      timeline: createCreativeStudioAnalyticsTimeline(),
      forecast: createCreativeStudioForecastEnvelope(),
      exceptions: createCreativeStudioExceptionLedger(),
      summary: summarizeCreativeStudioAnalytics()
    },
    operations: {
      board: createCreativeStudioOperationsBoard(),
      checklist: createCreativeStudioShiftChecklist(),
      incidents: createCreativeStudioIncidentDeck()
    },
    reporting: {
      cards: createCreativeStudioReportCards(),
      packets: createCreativeStudioReviewPackets(),
      summary: summarizeCreativeStudioReporting()
    },
    audit: {
      trail: createCreativeStudioAuditTrail(),
      manifest: createCreativeStudioEvidenceManifest(),
      attestation: createCreativeStudioReadinessAttestation()
    },
    playbooks: createCreativeStudioPlaybooks(),
    decisions: createCreativeStudioDecisionDeck(),
    escalationMoments: createCreativeStudioEscalationMoments()
  };
}

export function createCreativeStudioReadinessBoard(snapshot = buildCreativeStudioSnapshot()) {
  return [
    { id: 'creative-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeStudioApiDocument(snapshot = buildCreativeStudioSnapshot()) {
  return {
    id: 'creative-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-studio/overview' },
      { method: 'GET', path: '/api/creative-studio/reporting' },
      { method: 'POST', path: '/api/creative-studio/validate' },
      { method: 'GET', path: '/api/creative-studio/audit' }
    ],
    readiness: createCreativeStudioReadinessBoard(snapshot)
  };
}

export function createCreativeStudioRouteSummary(snapshot = buildCreativeStudioSnapshot()) {
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

