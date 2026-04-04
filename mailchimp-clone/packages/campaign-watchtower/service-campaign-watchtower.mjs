import { createCampaignWatchtowerWorkspace, summarizeCampaignWatchtowerWorkspace, createCampaignWatchtowerNarratives, createCampaignWatchtowerCoverageGrid } from './domain-campaign-watchtower.mjs';
import { createCampaignWatchtowerPolicies, validateCampaignWatchtowerPolicies, summarizeCampaignWatchtowerPolicies, createCampaignWatchtowerEscalationDeck } from './policies-campaign-watchtower.mjs';
import { createCampaignWatchtowerAnalyticsTimeline, createCampaignWatchtowerForecastEnvelope, createCampaignWatchtowerExceptionLedger, summarizeCampaignWatchtowerAnalytics } from './analytics-campaign-watchtower.mjs';
import { createCampaignWatchtowerOperationsBoard, createCampaignWatchtowerShiftChecklist, createCampaignWatchtowerIncidentDeck } from './operations-campaign-watchtower.mjs';
import { createCampaignWatchtowerReportCards, createCampaignWatchtowerReviewPackets, summarizeCampaignWatchtowerReporting } from './reporting-campaign-watchtower.mjs';
import { createCampaignWatchtowerAuditTrail, createCampaignWatchtowerEvidenceManifest, createCampaignWatchtowerReadinessAttestation } from './audit-campaign-watchtower.mjs';
import { createCampaignWatchtowerPlaybooks, createCampaignWatchtowerDecisionDeck, createCampaignWatchtowerEscalationMoments } from './playbooks-campaign-watchtower.mjs';

export function buildCampaignWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignWatchtowerWorkspace(workspaceName);
  const policies = createCampaignWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeCampaignWatchtowerWorkspace(workspace),
    narratives: createCampaignWatchtowerNarratives(workspace),
    coverage: createCampaignWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignWatchtowerPolicies(policies),
    validation: validateCampaignWatchtowerPolicies(policies),
    escalationDeck: createCampaignWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createCampaignWatchtowerAnalyticsTimeline(),
      forecast: createCampaignWatchtowerForecastEnvelope(),
      exceptions: createCampaignWatchtowerExceptionLedger(),
      summary: summarizeCampaignWatchtowerAnalytics()
    },
    operations: {
      board: createCampaignWatchtowerOperationsBoard(),
      checklist: createCampaignWatchtowerShiftChecklist(),
      incidents: createCampaignWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createCampaignWatchtowerReportCards(),
      packets: createCampaignWatchtowerReviewPackets(),
      summary: summarizeCampaignWatchtowerReporting()
    },
    audit: {
      trail: createCampaignWatchtowerAuditTrail(),
      manifest: createCampaignWatchtowerEvidenceManifest(),
      attestation: createCampaignWatchtowerReadinessAttestation()
    },
    playbooks: createCampaignWatchtowerPlaybooks(),
    decisions: createCampaignWatchtowerDecisionDeck(),
    escalationMoments: createCampaignWatchtowerEscalationMoments()
  };
}

export function createCampaignWatchtowerReadinessBoard(snapshot = buildCampaignWatchtowerSnapshot()) {
  return [
    { id: 'campaign-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignWatchtowerApiDocument(snapshot = buildCampaignWatchtowerSnapshot()) {
  return {
    id: 'campaign-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-watchtower/overview' },
      { method: 'GET', path: '/api/campaign-watchtower/reporting' },
      { method: 'POST', path: '/api/campaign-watchtower/validate' },
      { method: 'GET', path: '/api/campaign-watchtower/audit' }
    ],
    readiness: createCampaignWatchtowerReadinessBoard(snapshot)
  };
}

export function createCampaignWatchtowerRouteSummary(snapshot = buildCampaignWatchtowerSnapshot()) {
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

