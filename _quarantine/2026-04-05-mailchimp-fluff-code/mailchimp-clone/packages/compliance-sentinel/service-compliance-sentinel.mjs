import { createComplianceSentinelWorkspace, summarizeComplianceSentinelWorkspace, createComplianceSentinelNarratives, createComplianceSentinelCoverageGrid } from './domain-compliance-sentinel.mjs';
import { createComplianceSentinelPolicies, validateComplianceSentinelPolicies, summarizeComplianceSentinelPolicies, createComplianceSentinelEscalationDeck } from './policies-compliance-sentinel.mjs';
import { createComplianceSentinelAnalyticsTimeline, createComplianceSentinelForecastEnvelope, createComplianceSentinelExceptionLedger, summarizeComplianceSentinelAnalytics } from './analytics-compliance-sentinel.mjs';
import { createComplianceSentinelOperationsBoard, createComplianceSentinelShiftChecklist, createComplianceSentinelIncidentDeck } from './operations-compliance-sentinel.mjs';
import { createComplianceSentinelReportCards, createComplianceSentinelReviewPackets, summarizeComplianceSentinelReporting } from './reporting-compliance-sentinel.mjs';
import { createComplianceSentinelAuditTrail, createComplianceSentinelEvidenceManifest, createComplianceSentinelReadinessAttestation } from './audit-compliance-sentinel.mjs';
import { createComplianceSentinelPlaybooks, createComplianceSentinelDecisionDeck, createComplianceSentinelEscalationMoments } from './playbooks-compliance-sentinel.mjs';

export function buildComplianceSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceSentinelWorkspace(workspaceName);
  const policies = createComplianceSentinelPolicies();
  return {
    workspace,
    summary: summarizeComplianceSentinelWorkspace(workspace),
    narratives: createComplianceSentinelNarratives(workspace),
    coverage: createComplianceSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceSentinelPolicies(policies),
    validation: validateComplianceSentinelPolicies(policies),
    escalationDeck: createComplianceSentinelEscalationDeck(policies),
    analytics: {
      timeline: createComplianceSentinelAnalyticsTimeline(),
      forecast: createComplianceSentinelForecastEnvelope(),
      exceptions: createComplianceSentinelExceptionLedger(),
      summary: summarizeComplianceSentinelAnalytics()
    },
    operations: {
      board: createComplianceSentinelOperationsBoard(),
      checklist: createComplianceSentinelShiftChecklist(),
      incidents: createComplianceSentinelIncidentDeck()
    },
    reporting: {
      cards: createComplianceSentinelReportCards(),
      packets: createComplianceSentinelReviewPackets(),
      summary: summarizeComplianceSentinelReporting()
    },
    audit: {
      trail: createComplianceSentinelAuditTrail(),
      manifest: createComplianceSentinelEvidenceManifest(),
      attestation: createComplianceSentinelReadinessAttestation()
    },
    playbooks: createComplianceSentinelPlaybooks(),
    decisions: createComplianceSentinelDecisionDeck(),
    escalationMoments: createComplianceSentinelEscalationMoments()
  };
}

export function createComplianceSentinelReadinessBoard(snapshot = buildComplianceSentinelSnapshot()) {
  return [
    { id: 'compliance-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceSentinelApiDocument(snapshot = buildComplianceSentinelSnapshot()) {
  return {
    id: 'compliance-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-sentinel/overview' },
      { method: 'GET', path: '/api/compliance-sentinel/reporting' },
      { method: 'POST', path: '/api/compliance-sentinel/validate' },
      { method: 'GET', path: '/api/compliance-sentinel/audit' }
    ],
    readiness: createComplianceSentinelReadinessBoard(snapshot)
  };
}

export function createComplianceSentinelRouteSummary(snapshot = buildComplianceSentinelSnapshot()) {
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

