import { createAutomationSentinelWorkspace, summarizeAutomationSentinelWorkspace, createAutomationSentinelNarratives, createAutomationSentinelCoverageGrid } from './domain-automation-sentinel.mjs';
import { createAutomationSentinelPolicies, validateAutomationSentinelPolicies, summarizeAutomationSentinelPolicies, createAutomationSentinelEscalationDeck } from './policies-automation-sentinel.mjs';
import { createAutomationSentinelAnalyticsTimeline, createAutomationSentinelForecastEnvelope, createAutomationSentinelExceptionLedger, summarizeAutomationSentinelAnalytics } from './analytics-automation-sentinel.mjs';
import { createAutomationSentinelOperationsBoard, createAutomationSentinelShiftChecklist, createAutomationSentinelIncidentDeck } from './operations-automation-sentinel.mjs';
import { createAutomationSentinelReportCards, createAutomationSentinelReviewPackets, summarizeAutomationSentinelReporting } from './reporting-automation-sentinel.mjs';
import { createAutomationSentinelAuditTrail, createAutomationSentinelEvidenceManifest, createAutomationSentinelReadinessAttestation } from './audit-automation-sentinel.mjs';
import { createAutomationSentinelPlaybooks, createAutomationSentinelDecisionDeck, createAutomationSentinelEscalationMoments } from './playbooks-automation-sentinel.mjs';

export function buildAutomationSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationSentinelWorkspace(workspaceName);
  const policies = createAutomationSentinelPolicies();
  return {
    workspace,
    summary: summarizeAutomationSentinelWorkspace(workspace),
    narratives: createAutomationSentinelNarratives(workspace),
    coverage: createAutomationSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationSentinelPolicies(policies),
    validation: validateAutomationSentinelPolicies(policies),
    escalationDeck: createAutomationSentinelEscalationDeck(policies),
    analytics: {
      timeline: createAutomationSentinelAnalyticsTimeline(),
      forecast: createAutomationSentinelForecastEnvelope(),
      exceptions: createAutomationSentinelExceptionLedger(),
      summary: summarizeAutomationSentinelAnalytics()
    },
    operations: {
      board: createAutomationSentinelOperationsBoard(),
      checklist: createAutomationSentinelShiftChecklist(),
      incidents: createAutomationSentinelIncidentDeck()
    },
    reporting: {
      cards: createAutomationSentinelReportCards(),
      packets: createAutomationSentinelReviewPackets(),
      summary: summarizeAutomationSentinelReporting()
    },
    audit: {
      trail: createAutomationSentinelAuditTrail(),
      manifest: createAutomationSentinelEvidenceManifest(),
      attestation: createAutomationSentinelReadinessAttestation()
    },
    playbooks: createAutomationSentinelPlaybooks(),
    decisions: createAutomationSentinelDecisionDeck(),
    escalationMoments: createAutomationSentinelEscalationMoments()
  };
}

export function createAutomationSentinelReadinessBoard(snapshot = buildAutomationSentinelSnapshot()) {
  return [
    { id: 'automation-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationSentinelApiDocument(snapshot = buildAutomationSentinelSnapshot()) {
  return {
    id: 'automation-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-sentinel/overview' },
      { method: 'GET', path: '/api/automation-sentinel/reporting' },
      { method: 'POST', path: '/api/automation-sentinel/validate' },
      { method: 'GET', path: '/api/automation-sentinel/audit' }
    ],
    readiness: createAutomationSentinelReadinessBoard(snapshot)
  };
}

export function createAutomationSentinelRouteSummary(snapshot = buildAutomationSentinelSnapshot()) {
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

