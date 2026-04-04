import { createAdvocacySentinelWorkspace, summarizeAdvocacySentinelWorkspace, createAdvocacySentinelNarratives, createAdvocacySentinelCoverageGrid } from './domain-advocacy-sentinel.mjs';
import { createAdvocacySentinelPolicies, validateAdvocacySentinelPolicies, summarizeAdvocacySentinelPolicies, createAdvocacySentinelEscalationDeck } from './policies-advocacy-sentinel.mjs';
import { createAdvocacySentinelAnalyticsTimeline, createAdvocacySentinelForecastEnvelope, createAdvocacySentinelExceptionLedger, summarizeAdvocacySentinelAnalytics } from './analytics-advocacy-sentinel.mjs';
import { createAdvocacySentinelOperationsBoard, createAdvocacySentinelShiftChecklist, createAdvocacySentinelIncidentDeck } from './operations-advocacy-sentinel.mjs';
import { createAdvocacySentinelReportCards, createAdvocacySentinelReviewPackets, summarizeAdvocacySentinelReporting } from './reporting-advocacy-sentinel.mjs';
import { createAdvocacySentinelAuditTrail, createAdvocacySentinelEvidenceManifest, createAdvocacySentinelReadinessAttestation } from './audit-advocacy-sentinel.mjs';
import { createAdvocacySentinelPlaybooks, createAdvocacySentinelDecisionDeck, createAdvocacySentinelEscalationMoments } from './playbooks-advocacy-sentinel.mjs';

export function buildAdvocacySentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacySentinelWorkspace(workspaceName);
  const policies = createAdvocacySentinelPolicies();
  return {
    workspace,
    summary: summarizeAdvocacySentinelWorkspace(workspace),
    narratives: createAdvocacySentinelNarratives(workspace),
    coverage: createAdvocacySentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacySentinelPolicies(policies),
    validation: validateAdvocacySentinelPolicies(policies),
    escalationDeck: createAdvocacySentinelEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacySentinelAnalyticsTimeline(),
      forecast: createAdvocacySentinelForecastEnvelope(),
      exceptions: createAdvocacySentinelExceptionLedger(),
      summary: summarizeAdvocacySentinelAnalytics()
    },
    operations: {
      board: createAdvocacySentinelOperationsBoard(),
      checklist: createAdvocacySentinelShiftChecklist(),
      incidents: createAdvocacySentinelIncidentDeck()
    },
    reporting: {
      cards: createAdvocacySentinelReportCards(),
      packets: createAdvocacySentinelReviewPackets(),
      summary: summarizeAdvocacySentinelReporting()
    },
    audit: {
      trail: createAdvocacySentinelAuditTrail(),
      manifest: createAdvocacySentinelEvidenceManifest(),
      attestation: createAdvocacySentinelReadinessAttestation()
    },
    playbooks: createAdvocacySentinelPlaybooks(),
    decisions: createAdvocacySentinelDecisionDeck(),
    escalationMoments: createAdvocacySentinelEscalationMoments()
  };
}

export function createAdvocacySentinelReadinessBoard(snapshot = buildAdvocacySentinelSnapshot()) {
  return [
    { id: 'advocacy-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacySentinelApiDocument(snapshot = buildAdvocacySentinelSnapshot()) {
  return {
    id: 'advocacy-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-sentinel/overview' },
      { method: 'GET', path: '/api/advocacy-sentinel/reporting' },
      { method: 'POST', path: '/api/advocacy-sentinel/validate' },
      { method: 'GET', path: '/api/advocacy-sentinel/audit' }
    ],
    readiness: createAdvocacySentinelReadinessBoard(snapshot)
  };
}

export function createAdvocacySentinelRouteSummary(snapshot = buildAdvocacySentinelSnapshot()) {
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

