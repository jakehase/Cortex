import { createCampaignIndexWorkspace, summarizeCampaignIndexWorkspace, createCampaignIndexNarratives, createCampaignIndexCoverageGrid } from './domain-campaign-index.mjs';
import { createCampaignIndexPolicies, validateCampaignIndexPolicies, summarizeCampaignIndexPolicies, createCampaignIndexEscalationDeck } from './policies-campaign-index.mjs';
import { createCampaignIndexAnalyticsTimeline, createCampaignIndexForecastEnvelope, createCampaignIndexExceptionLedger, summarizeCampaignIndexAnalytics } from './analytics-campaign-index.mjs';
import { createCampaignIndexOperationsBoard, createCampaignIndexShiftChecklist, createCampaignIndexIncidentDeck } from './operations-campaign-index.mjs';
import { createCampaignIndexReportCards, createCampaignIndexReviewPackets, summarizeCampaignIndexReporting } from './reporting-campaign-index.mjs';
import { createCampaignIndexAuditTrail, createCampaignIndexEvidenceManifest, createCampaignIndexReadinessAttestation } from './audit-campaign-index.mjs';
import { createCampaignIndexPlaybooks, createCampaignIndexDecisionDeck, createCampaignIndexEscalationMoments } from './playbooks-campaign-index.mjs';

export function buildCampaignIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignIndexWorkspace(workspaceName);
  const policies = createCampaignIndexPolicies();
  return {
    workspace,
    summary: summarizeCampaignIndexWorkspace(workspace),
    narratives: createCampaignIndexNarratives(workspace),
    coverage: createCampaignIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignIndexPolicies(policies),
    validation: validateCampaignIndexPolicies(policies),
    escalationDeck: createCampaignIndexEscalationDeck(policies),
    analytics: {
      timeline: createCampaignIndexAnalyticsTimeline(),
      forecast: createCampaignIndexForecastEnvelope(),
      exceptions: createCampaignIndexExceptionLedger(),
      summary: summarizeCampaignIndexAnalytics()
    },
    operations: {
      board: createCampaignIndexOperationsBoard(),
      checklist: createCampaignIndexShiftChecklist(),
      incidents: createCampaignIndexIncidentDeck()
    },
    reporting: {
      cards: createCampaignIndexReportCards(),
      packets: createCampaignIndexReviewPackets(),
      summary: summarizeCampaignIndexReporting()
    },
    audit: {
      trail: createCampaignIndexAuditTrail(),
      manifest: createCampaignIndexEvidenceManifest(),
      attestation: createCampaignIndexReadinessAttestation()
    },
    playbooks: createCampaignIndexPlaybooks(),
    decisions: createCampaignIndexDecisionDeck(),
    escalationMoments: createCampaignIndexEscalationMoments()
  };
}

export function createCampaignIndexReadinessBoard(snapshot = buildCampaignIndexSnapshot()) {
  return [
    { id: 'campaign-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignIndexApiDocument(snapshot = buildCampaignIndexSnapshot()) {
  return {
    id: 'campaign-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-index/overview' },
      { method: 'GET', path: '/api/campaign-index/reporting' },
      { method: 'POST', path: '/api/campaign-index/validate' },
      { method: 'GET', path: '/api/campaign-index/audit' }
    ],
    readiness: createCampaignIndexReadinessBoard(snapshot)
  };
}

export function createCampaignIndexRouteSummary(snapshot = buildCampaignIndexSnapshot()) {
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

