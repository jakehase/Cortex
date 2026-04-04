import { createCollaborationStudioWorkspace, summarizeCollaborationStudioWorkspace, createCollaborationStudioNarratives, createCollaborationStudioCoverageGrid } from './domain-collaboration-studio.mjs';
import { createCollaborationStudioPolicies, validateCollaborationStudioPolicies, summarizeCollaborationStudioPolicies, createCollaborationStudioEscalationDeck } from './policies-collaboration-studio.mjs';
import { createCollaborationStudioAnalyticsTimeline, createCollaborationStudioForecastEnvelope, createCollaborationStudioExceptionLedger, summarizeCollaborationStudioAnalytics } from './analytics-collaboration-studio.mjs';
import { createCollaborationStudioOperationsBoard, createCollaborationStudioShiftChecklist, createCollaborationStudioIncidentDeck } from './operations-collaboration-studio.mjs';
import { createCollaborationStudioReportCards, createCollaborationStudioReviewPackets, summarizeCollaborationStudioReporting } from './reporting-collaboration-studio.mjs';
import { createCollaborationStudioAuditTrail, createCollaborationStudioEvidenceManifest, createCollaborationStudioReadinessAttestation } from './audit-collaboration-studio.mjs';
import { createCollaborationStudioPlaybooks, createCollaborationStudioDecisionDeck, createCollaborationStudioEscalationMoments } from './playbooks-collaboration-studio.mjs';

export function buildCollaborationStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationStudioWorkspace(workspaceName);
  const policies = createCollaborationStudioPolicies();
  return {
    workspace,
    summary: summarizeCollaborationStudioWorkspace(workspace),
    narratives: createCollaborationStudioNarratives(workspace),
    coverage: createCollaborationStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationStudioPolicies(policies),
    validation: validateCollaborationStudioPolicies(policies),
    escalationDeck: createCollaborationStudioEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationStudioAnalyticsTimeline(),
      forecast: createCollaborationStudioForecastEnvelope(),
      exceptions: createCollaborationStudioExceptionLedger(),
      summary: summarizeCollaborationStudioAnalytics()
    },
    operations: {
      board: createCollaborationStudioOperationsBoard(),
      checklist: createCollaborationStudioShiftChecklist(),
      incidents: createCollaborationStudioIncidentDeck()
    },
    reporting: {
      cards: createCollaborationStudioReportCards(),
      packets: createCollaborationStudioReviewPackets(),
      summary: summarizeCollaborationStudioReporting()
    },
    audit: {
      trail: createCollaborationStudioAuditTrail(),
      manifest: createCollaborationStudioEvidenceManifest(),
      attestation: createCollaborationStudioReadinessAttestation()
    },
    playbooks: createCollaborationStudioPlaybooks(),
    decisions: createCollaborationStudioDecisionDeck(),
    escalationMoments: createCollaborationStudioEscalationMoments()
  };
}

export function createCollaborationStudioReadinessBoard(snapshot = buildCollaborationStudioSnapshot()) {
  return [
    { id: 'collaboration-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationStudioApiDocument(snapshot = buildCollaborationStudioSnapshot()) {
  return {
    id: 'collaboration-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-studio/overview' },
      { method: 'GET', path: '/api/collaboration-studio/reporting' },
      { method: 'POST', path: '/api/collaboration-studio/validate' },
      { method: 'GET', path: '/api/collaboration-studio/audit' }
    ],
    readiness: createCollaborationStudioReadinessBoard(snapshot)
  };
}

export function createCollaborationStudioRouteSummary(snapshot = buildCollaborationStudioSnapshot()) {
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

