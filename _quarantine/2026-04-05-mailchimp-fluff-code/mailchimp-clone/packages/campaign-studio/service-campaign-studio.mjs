import { createCampaignStudioWorkspace, summarizeCampaignStudioWorkspace, createCampaignStudioNarratives, createCampaignStudioCoverageGrid } from './domain-campaign-studio.mjs';
import { createCampaignStudioPolicies, validateCampaignStudioPolicies, summarizeCampaignStudioPolicies, createCampaignStudioEscalationDeck } from './policies-campaign-studio.mjs';
import { createCampaignStudioAnalyticsTimeline, createCampaignStudioForecastEnvelope, createCampaignStudioExceptionLedger, summarizeCampaignStudioAnalytics } from './analytics-campaign-studio.mjs';
import { createCampaignStudioOperationsBoard, createCampaignStudioShiftChecklist, createCampaignStudioIncidentDeck } from './operations-campaign-studio.mjs';
import { createCampaignStudioReportCards, createCampaignStudioReviewPackets, summarizeCampaignStudioReporting } from './reporting-campaign-studio.mjs';
import { createCampaignStudioAuditTrail, createCampaignStudioEvidenceManifest, createCampaignStudioReadinessAttestation } from './audit-campaign-studio.mjs';
import { createCampaignStudioPlaybooks, createCampaignStudioDecisionDeck, createCampaignStudioEscalationMoments } from './playbooks-campaign-studio.mjs';

export function buildCampaignStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignStudioWorkspace(workspaceName);
  const policies = createCampaignStudioPolicies();
  return {
    workspace,
    summary: summarizeCampaignStudioWorkspace(workspace),
    narratives: createCampaignStudioNarratives(workspace),
    coverage: createCampaignStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignStudioPolicies(policies),
    validation: validateCampaignStudioPolicies(policies),
    escalationDeck: createCampaignStudioEscalationDeck(policies),
    analytics: {
      timeline: createCampaignStudioAnalyticsTimeline(),
      forecast: createCampaignStudioForecastEnvelope(),
      exceptions: createCampaignStudioExceptionLedger(),
      summary: summarizeCampaignStudioAnalytics()
    },
    operations: {
      board: createCampaignStudioOperationsBoard(),
      checklist: createCampaignStudioShiftChecklist(),
      incidents: createCampaignStudioIncidentDeck()
    },
    reporting: {
      cards: createCampaignStudioReportCards(),
      packets: createCampaignStudioReviewPackets(),
      summary: summarizeCampaignStudioReporting()
    },
    audit: {
      trail: createCampaignStudioAuditTrail(),
      manifest: createCampaignStudioEvidenceManifest(),
      attestation: createCampaignStudioReadinessAttestation()
    },
    playbooks: createCampaignStudioPlaybooks(),
    decisions: createCampaignStudioDecisionDeck(),
    escalationMoments: createCampaignStudioEscalationMoments()
  };
}

export function createCampaignStudioReadinessBoard(snapshot = buildCampaignStudioSnapshot()) {
  return [
    { id: 'campaign-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignStudioApiDocument(snapshot = buildCampaignStudioSnapshot()) {
  return {
    id: 'campaign-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-studio/overview' },
      { method: 'GET', path: '/api/campaign-studio/reporting' },
      { method: 'POST', path: '/api/campaign-studio/validate' },
      { method: 'GET', path: '/api/campaign-studio/audit' }
    ],
    readiness: createCampaignStudioReadinessBoard(snapshot)
  };
}

export function createCampaignStudioRouteSummary(snapshot = buildCampaignStudioSnapshot()) {
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

