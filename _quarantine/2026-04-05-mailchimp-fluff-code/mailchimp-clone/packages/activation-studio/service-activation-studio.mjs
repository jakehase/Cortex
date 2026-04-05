import { createActivationStudioWorkspace, summarizeActivationStudioWorkspace, createActivationStudioNarratives, createActivationStudioCoverageGrid } from './domain-activation-studio.mjs';
import { createActivationStudioPolicies, validateActivationStudioPolicies, summarizeActivationStudioPolicies, createActivationStudioEscalationDeck } from './policies-activation-studio.mjs';
import { createActivationStudioAnalyticsTimeline, createActivationStudioForecastEnvelope, createActivationStudioExceptionLedger, summarizeActivationStudioAnalytics } from './analytics-activation-studio.mjs';
import { createActivationStudioOperationsBoard, createActivationStudioShiftChecklist, createActivationStudioIncidentDeck } from './operations-activation-studio.mjs';
import { createActivationStudioReportCards, createActivationStudioReviewPackets, summarizeActivationStudioReporting } from './reporting-activation-studio.mjs';
import { createActivationStudioAuditTrail, createActivationStudioEvidenceManifest, createActivationStudioReadinessAttestation } from './audit-activation-studio.mjs';
import { createActivationStudioPlaybooks, createActivationStudioDecisionDeck, createActivationStudioEscalationMoments } from './playbooks-activation-studio.mjs';

export function buildActivationStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationStudioWorkspace(workspaceName);
  const policies = createActivationStudioPolicies();
  return {
    workspace,
    summary: summarizeActivationStudioWorkspace(workspace),
    narratives: createActivationStudioNarratives(workspace),
    coverage: createActivationStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationStudioPolicies(policies),
    validation: validateActivationStudioPolicies(policies),
    escalationDeck: createActivationStudioEscalationDeck(policies),
    analytics: {
      timeline: createActivationStudioAnalyticsTimeline(),
      forecast: createActivationStudioForecastEnvelope(),
      exceptions: createActivationStudioExceptionLedger(),
      summary: summarizeActivationStudioAnalytics()
    },
    operations: {
      board: createActivationStudioOperationsBoard(),
      checklist: createActivationStudioShiftChecklist(),
      incidents: createActivationStudioIncidentDeck()
    },
    reporting: {
      cards: createActivationStudioReportCards(),
      packets: createActivationStudioReviewPackets(),
      summary: summarizeActivationStudioReporting()
    },
    audit: {
      trail: createActivationStudioAuditTrail(),
      manifest: createActivationStudioEvidenceManifest(),
      attestation: createActivationStudioReadinessAttestation()
    },
    playbooks: createActivationStudioPlaybooks(),
    decisions: createActivationStudioDecisionDeck(),
    escalationMoments: createActivationStudioEscalationMoments()
  };
}

export function createActivationStudioReadinessBoard(snapshot = buildActivationStudioSnapshot()) {
  return [
    { id: 'activation-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationStudioApiDocument(snapshot = buildActivationStudioSnapshot()) {
  return {
    id: 'activation-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-studio/overview' },
      { method: 'GET', path: '/api/activation-studio/reporting' },
      { method: 'POST', path: '/api/activation-studio/validate' },
      { method: 'GET', path: '/api/activation-studio/audit' }
    ],
    readiness: createActivationStudioReadinessBoard(snapshot)
  };
}

export function createActivationStudioRouteSummary(snapshot = buildActivationStudioSnapshot()) {
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

