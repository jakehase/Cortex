import { createIntegrationsStudioWorkspace, summarizeIntegrationsStudioWorkspace, createIntegrationsStudioNarratives, createIntegrationsStudioCoverageGrid } from './domain-integrations-studio.mjs';
import { createIntegrationsStudioPolicies, validateIntegrationsStudioPolicies, summarizeIntegrationsStudioPolicies, createIntegrationsStudioEscalationDeck } from './policies-integrations-studio.mjs';
import { createIntegrationsStudioAnalyticsTimeline, createIntegrationsStudioForecastEnvelope, createIntegrationsStudioExceptionLedger, summarizeIntegrationsStudioAnalytics } from './analytics-integrations-studio.mjs';
import { createIntegrationsStudioOperationsBoard, createIntegrationsStudioShiftChecklist, createIntegrationsStudioIncidentDeck } from './operations-integrations-studio.mjs';
import { createIntegrationsStudioReportCards, createIntegrationsStudioReviewPackets, summarizeIntegrationsStudioReporting } from './reporting-integrations-studio.mjs';
import { createIntegrationsStudioAuditTrail, createIntegrationsStudioEvidenceManifest, createIntegrationsStudioReadinessAttestation } from './audit-integrations-studio.mjs';
import { createIntegrationsStudioPlaybooks, createIntegrationsStudioDecisionDeck, createIntegrationsStudioEscalationMoments } from './playbooks-integrations-studio.mjs';

export function buildIntegrationsStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsStudioWorkspace(workspaceName);
  const policies = createIntegrationsStudioPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsStudioWorkspace(workspace),
    narratives: createIntegrationsStudioNarratives(workspace),
    coverage: createIntegrationsStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsStudioPolicies(policies),
    validation: validateIntegrationsStudioPolicies(policies),
    escalationDeck: createIntegrationsStudioEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsStudioAnalyticsTimeline(),
      forecast: createIntegrationsStudioForecastEnvelope(),
      exceptions: createIntegrationsStudioExceptionLedger(),
      summary: summarizeIntegrationsStudioAnalytics()
    },
    operations: {
      board: createIntegrationsStudioOperationsBoard(),
      checklist: createIntegrationsStudioShiftChecklist(),
      incidents: createIntegrationsStudioIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsStudioReportCards(),
      packets: createIntegrationsStudioReviewPackets(),
      summary: summarizeIntegrationsStudioReporting()
    },
    audit: {
      trail: createIntegrationsStudioAuditTrail(),
      manifest: createIntegrationsStudioEvidenceManifest(),
      attestation: createIntegrationsStudioReadinessAttestation()
    },
    playbooks: createIntegrationsStudioPlaybooks(),
    decisions: createIntegrationsStudioDecisionDeck(),
    escalationMoments: createIntegrationsStudioEscalationMoments()
  };
}

export function createIntegrationsStudioReadinessBoard(snapshot = buildIntegrationsStudioSnapshot()) {
  return [
    { id: 'integrations-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsStudioApiDocument(snapshot = buildIntegrationsStudioSnapshot()) {
  return {
    id: 'integrations-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-studio/overview' },
      { method: 'GET', path: '/api/integrations-studio/reporting' },
      { method: 'POST', path: '/api/integrations-studio/validate' },
      { method: 'GET', path: '/api/integrations-studio/audit' }
    ],
    readiness: createIntegrationsStudioReadinessBoard(snapshot)
  };
}

export function createIntegrationsStudioRouteSummary(snapshot = buildIntegrationsStudioSnapshot()) {
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

