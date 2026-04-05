import { createLocalizationSentinelWorkspace, summarizeLocalizationSentinelWorkspace, createLocalizationSentinelNarratives, createLocalizationSentinelCoverageGrid } from './domain-localization-sentinel.mjs';
import { createLocalizationSentinelPolicies, validateLocalizationSentinelPolicies, summarizeLocalizationSentinelPolicies, createLocalizationSentinelEscalationDeck } from './policies-localization-sentinel.mjs';
import { createLocalizationSentinelAnalyticsTimeline, createLocalizationSentinelForecastEnvelope, createLocalizationSentinelExceptionLedger, summarizeLocalizationSentinelAnalytics } from './analytics-localization-sentinel.mjs';
import { createLocalizationSentinelOperationsBoard, createLocalizationSentinelShiftChecklist, createLocalizationSentinelIncidentDeck } from './operations-localization-sentinel.mjs';
import { createLocalizationSentinelReportCards, createLocalizationSentinelReviewPackets, summarizeLocalizationSentinelReporting } from './reporting-localization-sentinel.mjs';
import { createLocalizationSentinelAuditTrail, createLocalizationSentinelEvidenceManifest, createLocalizationSentinelReadinessAttestation } from './audit-localization-sentinel.mjs';
import { createLocalizationSentinelPlaybooks, createLocalizationSentinelDecisionDeck, createLocalizationSentinelEscalationMoments } from './playbooks-localization-sentinel.mjs';

export function buildLocalizationSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationSentinelWorkspace(workspaceName);
  const policies = createLocalizationSentinelPolicies();
  return {
    workspace,
    summary: summarizeLocalizationSentinelWorkspace(workspace),
    narratives: createLocalizationSentinelNarratives(workspace),
    coverage: createLocalizationSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationSentinelPolicies(policies),
    validation: validateLocalizationSentinelPolicies(policies),
    escalationDeck: createLocalizationSentinelEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationSentinelAnalyticsTimeline(),
      forecast: createLocalizationSentinelForecastEnvelope(),
      exceptions: createLocalizationSentinelExceptionLedger(),
      summary: summarizeLocalizationSentinelAnalytics()
    },
    operations: {
      board: createLocalizationSentinelOperationsBoard(),
      checklist: createLocalizationSentinelShiftChecklist(),
      incidents: createLocalizationSentinelIncidentDeck()
    },
    reporting: {
      cards: createLocalizationSentinelReportCards(),
      packets: createLocalizationSentinelReviewPackets(),
      summary: summarizeLocalizationSentinelReporting()
    },
    audit: {
      trail: createLocalizationSentinelAuditTrail(),
      manifest: createLocalizationSentinelEvidenceManifest(),
      attestation: createLocalizationSentinelReadinessAttestation()
    },
    playbooks: createLocalizationSentinelPlaybooks(),
    decisions: createLocalizationSentinelDecisionDeck(),
    escalationMoments: createLocalizationSentinelEscalationMoments()
  };
}

export function createLocalizationSentinelReadinessBoard(snapshot = buildLocalizationSentinelSnapshot()) {
  return [
    { id: 'localization-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationSentinelApiDocument(snapshot = buildLocalizationSentinelSnapshot()) {
  return {
    id: 'localization-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-sentinel/overview' },
      { method: 'GET', path: '/api/localization-sentinel/reporting' },
      { method: 'POST', path: '/api/localization-sentinel/validate' },
      { method: 'GET', path: '/api/localization-sentinel/audit' }
    ],
    readiness: createLocalizationSentinelReadinessBoard(snapshot)
  };
}

export function createLocalizationSentinelRouteSummary(snapshot = buildLocalizationSentinelSnapshot()) {
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

