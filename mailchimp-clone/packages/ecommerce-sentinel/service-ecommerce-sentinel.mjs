import { createEcommerceSentinelWorkspace, summarizeEcommerceSentinelWorkspace, createEcommerceSentinelNarratives, createEcommerceSentinelCoverageGrid } from './domain-ecommerce-sentinel.mjs';
import { createEcommerceSentinelPolicies, validateEcommerceSentinelPolicies, summarizeEcommerceSentinelPolicies, createEcommerceSentinelEscalationDeck } from './policies-ecommerce-sentinel.mjs';
import { createEcommerceSentinelAnalyticsTimeline, createEcommerceSentinelForecastEnvelope, createEcommerceSentinelExceptionLedger, summarizeEcommerceSentinelAnalytics } from './analytics-ecommerce-sentinel.mjs';
import { createEcommerceSentinelOperationsBoard, createEcommerceSentinelShiftChecklist, createEcommerceSentinelIncidentDeck } from './operations-ecommerce-sentinel.mjs';
import { createEcommerceSentinelReportCards, createEcommerceSentinelReviewPackets, summarizeEcommerceSentinelReporting } from './reporting-ecommerce-sentinel.mjs';
import { createEcommerceSentinelAuditTrail, createEcommerceSentinelEvidenceManifest, createEcommerceSentinelReadinessAttestation } from './audit-ecommerce-sentinel.mjs';
import { createEcommerceSentinelPlaybooks, createEcommerceSentinelDecisionDeck, createEcommerceSentinelEscalationMoments } from './playbooks-ecommerce-sentinel.mjs';

export function buildEcommerceSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceSentinelWorkspace(workspaceName);
  const policies = createEcommerceSentinelPolicies();
  return {
    workspace,
    summary: summarizeEcommerceSentinelWorkspace(workspace),
    narratives: createEcommerceSentinelNarratives(workspace),
    coverage: createEcommerceSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceSentinelPolicies(policies),
    validation: validateEcommerceSentinelPolicies(policies),
    escalationDeck: createEcommerceSentinelEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceSentinelAnalyticsTimeline(),
      forecast: createEcommerceSentinelForecastEnvelope(),
      exceptions: createEcommerceSentinelExceptionLedger(),
      summary: summarizeEcommerceSentinelAnalytics()
    },
    operations: {
      board: createEcommerceSentinelOperationsBoard(),
      checklist: createEcommerceSentinelShiftChecklist(),
      incidents: createEcommerceSentinelIncidentDeck()
    },
    reporting: {
      cards: createEcommerceSentinelReportCards(),
      packets: createEcommerceSentinelReviewPackets(),
      summary: summarizeEcommerceSentinelReporting()
    },
    audit: {
      trail: createEcommerceSentinelAuditTrail(),
      manifest: createEcommerceSentinelEvidenceManifest(),
      attestation: createEcommerceSentinelReadinessAttestation()
    },
    playbooks: createEcommerceSentinelPlaybooks(),
    decisions: createEcommerceSentinelDecisionDeck(),
    escalationMoments: createEcommerceSentinelEscalationMoments()
  };
}

export function createEcommerceSentinelReadinessBoard(snapshot = buildEcommerceSentinelSnapshot()) {
  return [
    { id: 'ecommerce-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceSentinelApiDocument(snapshot = buildEcommerceSentinelSnapshot()) {
  return {
    id: 'ecommerce-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-sentinel/overview' },
      { method: 'GET', path: '/api/ecommerce-sentinel/reporting' },
      { method: 'POST', path: '/api/ecommerce-sentinel/validate' },
      { method: 'GET', path: '/api/ecommerce-sentinel/audit' }
    ],
    readiness: createEcommerceSentinelReadinessBoard(snapshot)
  };
}

export function createEcommerceSentinelRouteSummary(snapshot = buildEcommerceSentinelSnapshot()) {
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

