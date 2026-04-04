import { createCampaignSentinelWorkspace, summarizeCampaignSentinelWorkspace, createCampaignSentinelNarratives, createCampaignSentinelCoverageGrid } from './domain-campaign-sentinel.mjs';
import { createCampaignSentinelPolicies, validateCampaignSentinelPolicies, summarizeCampaignSentinelPolicies, createCampaignSentinelEscalationDeck } from './policies-campaign-sentinel.mjs';
import { createCampaignSentinelAnalyticsTimeline, createCampaignSentinelForecastEnvelope, createCampaignSentinelExceptionLedger, summarizeCampaignSentinelAnalytics } from './analytics-campaign-sentinel.mjs';
import { createCampaignSentinelOperationsBoard, createCampaignSentinelShiftChecklist, createCampaignSentinelIncidentDeck } from './operations-campaign-sentinel.mjs';
import { createCampaignSentinelReportCards, createCampaignSentinelReviewPackets, summarizeCampaignSentinelReporting } from './reporting-campaign-sentinel.mjs';
import { createCampaignSentinelAuditTrail, createCampaignSentinelEvidenceManifest, createCampaignSentinelReadinessAttestation } from './audit-campaign-sentinel.mjs';
import { createCampaignSentinelPlaybooks, createCampaignSentinelDecisionDeck, createCampaignSentinelEscalationMoments } from './playbooks-campaign-sentinel.mjs';

export function buildCampaignSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignSentinelWorkspace(workspaceName);
  const policies = createCampaignSentinelPolicies();
  return {
    workspace,
    summary: summarizeCampaignSentinelWorkspace(workspace),
    narratives: createCampaignSentinelNarratives(workspace),
    coverage: createCampaignSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignSentinelPolicies(policies),
    validation: validateCampaignSentinelPolicies(policies),
    escalationDeck: createCampaignSentinelEscalationDeck(policies),
    analytics: {
      timeline: createCampaignSentinelAnalyticsTimeline(),
      forecast: createCampaignSentinelForecastEnvelope(),
      exceptions: createCampaignSentinelExceptionLedger(),
      summary: summarizeCampaignSentinelAnalytics()
    },
    operations: {
      board: createCampaignSentinelOperationsBoard(),
      checklist: createCampaignSentinelShiftChecklist(),
      incidents: createCampaignSentinelIncidentDeck()
    },
    reporting: {
      cards: createCampaignSentinelReportCards(),
      packets: createCampaignSentinelReviewPackets(),
      summary: summarizeCampaignSentinelReporting()
    },
    audit: {
      trail: createCampaignSentinelAuditTrail(),
      manifest: createCampaignSentinelEvidenceManifest(),
      attestation: createCampaignSentinelReadinessAttestation()
    },
    playbooks: createCampaignSentinelPlaybooks(),
    decisions: createCampaignSentinelDecisionDeck(),
    escalationMoments: createCampaignSentinelEscalationMoments()
  };
}

export function createCampaignSentinelReadinessBoard(snapshot = buildCampaignSentinelSnapshot()) {
  return [
    { id: 'campaign-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignSentinelApiDocument(snapshot = buildCampaignSentinelSnapshot()) {
  return {
    id: 'campaign-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-sentinel/overview' },
      { method: 'GET', path: '/api/campaign-sentinel/reporting' },
      { method: 'POST', path: '/api/campaign-sentinel/validate' },
      { method: 'GET', path: '/api/campaign-sentinel/audit' }
    ],
    readiness: createCampaignSentinelReadinessBoard(snapshot)
  };
}

export function createCampaignSentinelRouteSummary(snapshot = buildCampaignSentinelSnapshot()) {
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

