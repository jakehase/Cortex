import { createDeliverabilityStudioWorkspace, summarizeDeliverabilityStudioWorkspace, createDeliverabilityStudioNarratives, createDeliverabilityStudioCoverageGrid } from './domain-deliverability-studio.mjs';
import { createDeliverabilityStudioPolicies, validateDeliverabilityStudioPolicies, summarizeDeliverabilityStudioPolicies, createDeliverabilityStudioEscalationDeck } from './policies-deliverability-studio.mjs';
import { createDeliverabilityStudioAnalyticsTimeline, createDeliverabilityStudioForecastEnvelope, createDeliverabilityStudioExceptionLedger, summarizeDeliverabilityStudioAnalytics } from './analytics-deliverability-studio.mjs';
import { createDeliverabilityStudioOperationsBoard, createDeliverabilityStudioShiftChecklist, createDeliverabilityStudioIncidentDeck } from './operations-deliverability-studio.mjs';
import { createDeliverabilityStudioReportCards, createDeliverabilityStudioReviewPackets, summarizeDeliverabilityStudioReporting } from './reporting-deliverability-studio.mjs';
import { createDeliverabilityStudioAuditTrail, createDeliverabilityStudioEvidenceManifest, createDeliverabilityStudioReadinessAttestation } from './audit-deliverability-studio.mjs';
import { createDeliverabilityStudioPlaybooks, createDeliverabilityStudioDecisionDeck, createDeliverabilityStudioEscalationMoments } from './playbooks-deliverability-studio.mjs';

export function buildDeliverabilityStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityStudioWorkspace(workspaceName);
  const policies = createDeliverabilityStudioPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityStudioWorkspace(workspace),
    narratives: createDeliverabilityStudioNarratives(workspace),
    coverage: createDeliverabilityStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityStudioPolicies(policies),
    validation: validateDeliverabilityStudioPolicies(policies),
    escalationDeck: createDeliverabilityStudioEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityStudioAnalyticsTimeline(),
      forecast: createDeliverabilityStudioForecastEnvelope(),
      exceptions: createDeliverabilityStudioExceptionLedger(),
      summary: summarizeDeliverabilityStudioAnalytics()
    },
    operations: {
      board: createDeliverabilityStudioOperationsBoard(),
      checklist: createDeliverabilityStudioShiftChecklist(),
      incidents: createDeliverabilityStudioIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityStudioReportCards(),
      packets: createDeliverabilityStudioReviewPackets(),
      summary: summarizeDeliverabilityStudioReporting()
    },
    audit: {
      trail: createDeliverabilityStudioAuditTrail(),
      manifest: createDeliverabilityStudioEvidenceManifest(),
      attestation: createDeliverabilityStudioReadinessAttestation()
    },
    playbooks: createDeliverabilityStudioPlaybooks(),
    decisions: createDeliverabilityStudioDecisionDeck(),
    escalationMoments: createDeliverabilityStudioEscalationMoments()
  };
}

export function createDeliverabilityStudioReadinessBoard(snapshot = buildDeliverabilityStudioSnapshot()) {
  return [
    { id: 'deliverability-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityStudioApiDocument(snapshot = buildDeliverabilityStudioSnapshot()) {
  return {
    id: 'deliverability-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-studio/overview' },
      { method: 'GET', path: '/api/deliverability-studio/reporting' },
      { method: 'POST', path: '/api/deliverability-studio/validate' },
      { method: 'GET', path: '/api/deliverability-studio/audit' }
    ],
    readiness: createDeliverabilityStudioReadinessBoard(snapshot)
  };
}

export function createDeliverabilityStudioRouteSummary(snapshot = buildDeliverabilityStudioSnapshot()) {
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

