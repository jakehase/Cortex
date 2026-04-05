import { createCampaignHubWorkspace, summarizeCampaignHubWorkspace, createCampaignHubNarratives, createCampaignHubCoverageGrid } from './domain-campaign-hub.mjs';
import { createCampaignHubPolicies, validateCampaignHubPolicies, summarizeCampaignHubPolicies, createCampaignHubEscalationDeck } from './policies-campaign-hub.mjs';
import { createCampaignHubAnalyticsTimeline, createCampaignHubForecastEnvelope, createCampaignHubExceptionLedger, summarizeCampaignHubAnalytics } from './analytics-campaign-hub.mjs';
import { createCampaignHubOperationsBoard, createCampaignHubShiftChecklist, createCampaignHubIncidentDeck } from './operations-campaign-hub.mjs';
import { createCampaignHubReportCards, createCampaignHubReviewPackets, summarizeCampaignHubReporting } from './reporting-campaign-hub.mjs';
import { createCampaignHubAuditTrail, createCampaignHubEvidenceManifest, createCampaignHubReadinessAttestation } from './audit-campaign-hub.mjs';
import { createCampaignHubPlaybooks, createCampaignHubDecisionDeck, createCampaignHubEscalationMoments } from './playbooks-campaign-hub.mjs';

export function buildCampaignHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignHubWorkspace(workspaceName);
  const policies = createCampaignHubPolicies();
  return {
    workspace,
    summary: summarizeCampaignHubWorkspace(workspace),
    narratives: createCampaignHubNarratives(workspace),
    coverage: createCampaignHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignHubPolicies(policies),
    validation: validateCampaignHubPolicies(policies),
    escalationDeck: createCampaignHubEscalationDeck(policies),
    analytics: {
      timeline: createCampaignHubAnalyticsTimeline(),
      forecast: createCampaignHubForecastEnvelope(),
      exceptions: createCampaignHubExceptionLedger(),
      summary: summarizeCampaignHubAnalytics()
    },
    operations: {
      board: createCampaignHubOperationsBoard(),
      checklist: createCampaignHubShiftChecklist(),
      incidents: createCampaignHubIncidentDeck()
    },
    reporting: {
      cards: createCampaignHubReportCards(),
      packets: createCampaignHubReviewPackets(),
      summary: summarizeCampaignHubReporting()
    },
    audit: {
      trail: createCampaignHubAuditTrail(),
      manifest: createCampaignHubEvidenceManifest(),
      attestation: createCampaignHubReadinessAttestation()
    },
    playbooks: createCampaignHubPlaybooks(),
    decisions: createCampaignHubDecisionDeck(),
    escalationMoments: createCampaignHubEscalationMoments()
  };
}

export function createCampaignHubReadinessBoard(snapshot = buildCampaignHubSnapshot()) {
  return [
    { id: 'campaign-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignHubApiDocument(snapshot = buildCampaignHubSnapshot()) {
  return {
    id: 'campaign-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-hub/overview' },
      { method: 'GET', path: '/api/campaign-hub/reporting' },
      { method: 'POST', path: '/api/campaign-hub/validate' },
      { method: 'GET', path: '/api/campaign-hub/audit' }
    ],
    readiness: createCampaignHubReadinessBoard(snapshot)
  };
}

export function createCampaignHubRouteSummary(snapshot = buildCampaignHubSnapshot()) {
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

