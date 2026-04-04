import { createIntegrationsSentinelWorkspace, summarizeIntegrationsSentinelWorkspace, createIntegrationsSentinelNarratives, createIntegrationsSentinelCoverageGrid } from './domain-integrations-sentinel.mjs';
import { createIntegrationsSentinelPolicies, validateIntegrationsSentinelPolicies, summarizeIntegrationsSentinelPolicies, createIntegrationsSentinelEscalationDeck } from './policies-integrations-sentinel.mjs';
import { createIntegrationsSentinelAnalyticsTimeline, createIntegrationsSentinelForecastEnvelope, createIntegrationsSentinelExceptionLedger, summarizeIntegrationsSentinelAnalytics } from './analytics-integrations-sentinel.mjs';
import { createIntegrationsSentinelOperationsBoard, createIntegrationsSentinelShiftChecklist, createIntegrationsSentinelIncidentDeck } from './operations-integrations-sentinel.mjs';
import { createIntegrationsSentinelReportCards, createIntegrationsSentinelReviewPackets, summarizeIntegrationsSentinelReporting } from './reporting-integrations-sentinel.mjs';
import { createIntegrationsSentinelAuditTrail, createIntegrationsSentinelEvidenceManifest, createIntegrationsSentinelReadinessAttestation } from './audit-integrations-sentinel.mjs';
import { createIntegrationsSentinelPlaybooks, createIntegrationsSentinelDecisionDeck, createIntegrationsSentinelEscalationMoments } from './playbooks-integrations-sentinel.mjs';

export function buildIntegrationsSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsSentinelWorkspace(workspaceName);
  const policies = createIntegrationsSentinelPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsSentinelWorkspace(workspace),
    narratives: createIntegrationsSentinelNarratives(workspace),
    coverage: createIntegrationsSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsSentinelPolicies(policies),
    validation: validateIntegrationsSentinelPolicies(policies),
    escalationDeck: createIntegrationsSentinelEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsSentinelAnalyticsTimeline(),
      forecast: createIntegrationsSentinelForecastEnvelope(),
      exceptions: createIntegrationsSentinelExceptionLedger(),
      summary: summarizeIntegrationsSentinelAnalytics()
    },
    operations: {
      board: createIntegrationsSentinelOperationsBoard(),
      checklist: createIntegrationsSentinelShiftChecklist(),
      incidents: createIntegrationsSentinelIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsSentinelReportCards(),
      packets: createIntegrationsSentinelReviewPackets(),
      summary: summarizeIntegrationsSentinelReporting()
    },
    audit: {
      trail: createIntegrationsSentinelAuditTrail(),
      manifest: createIntegrationsSentinelEvidenceManifest(),
      attestation: createIntegrationsSentinelReadinessAttestation()
    },
    playbooks: createIntegrationsSentinelPlaybooks(),
    decisions: createIntegrationsSentinelDecisionDeck(),
    escalationMoments: createIntegrationsSentinelEscalationMoments()
  };
}

export function createIntegrationsSentinelReadinessBoard(snapshot = buildIntegrationsSentinelSnapshot()) {
  return [
    { id: 'integrations-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsSentinelApiDocument(snapshot = buildIntegrationsSentinelSnapshot()) {
  return {
    id: 'integrations-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-sentinel/overview' },
      { method: 'GET', path: '/api/integrations-sentinel/reporting' },
      { method: 'POST', path: '/api/integrations-sentinel/validate' },
      { method: 'GET', path: '/api/integrations-sentinel/audit' }
    ],
    readiness: createIntegrationsSentinelReadinessBoard(snapshot)
  };
}

export function createIntegrationsSentinelRouteSummary(snapshot = buildIntegrationsSentinelSnapshot()) {
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

