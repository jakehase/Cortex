import { createCampaignScorecardWorkspace, summarizeCampaignScorecardWorkspace, createCampaignScorecardNarratives, createCampaignScorecardCoverageGrid } from './domain-campaign-scorecard.mjs';
import { createCampaignScorecardPolicies, validateCampaignScorecardPolicies, summarizeCampaignScorecardPolicies, createCampaignScorecardEscalationDeck } from './policies-campaign-scorecard.mjs';
import { createCampaignScorecardAnalyticsTimeline, createCampaignScorecardForecastEnvelope, createCampaignScorecardExceptionLedger, summarizeCampaignScorecardAnalytics } from './analytics-campaign-scorecard.mjs';
import { createCampaignScorecardOperationsBoard, createCampaignScorecardShiftChecklist, createCampaignScorecardIncidentDeck } from './operations-campaign-scorecard.mjs';
import { createCampaignScorecardReportCards, createCampaignScorecardReviewPackets, summarizeCampaignScorecardReporting } from './reporting-campaign-scorecard.mjs';
import { createCampaignScorecardAuditTrail, createCampaignScorecardEvidenceManifest, createCampaignScorecardReadinessAttestation } from './audit-campaign-scorecard.mjs';
import { createCampaignScorecardPlaybooks, createCampaignScorecardDecisionDeck, createCampaignScorecardEscalationMoments } from './playbooks-campaign-scorecard.mjs';

export function buildCampaignScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignScorecardWorkspace(workspaceName);
  const policies = createCampaignScorecardPolicies();
  return {
    workspace,
    summary: summarizeCampaignScorecardWorkspace(workspace),
    narratives: createCampaignScorecardNarratives(workspace),
    coverage: createCampaignScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignScorecardPolicies(policies),
    validation: validateCampaignScorecardPolicies(policies),
    escalationDeck: createCampaignScorecardEscalationDeck(policies),
    analytics: {
      timeline: createCampaignScorecardAnalyticsTimeline(),
      forecast: createCampaignScorecardForecastEnvelope(),
      exceptions: createCampaignScorecardExceptionLedger(),
      summary: summarizeCampaignScorecardAnalytics()
    },
    operations: {
      board: createCampaignScorecardOperationsBoard(),
      checklist: createCampaignScorecardShiftChecklist(),
      incidents: createCampaignScorecardIncidentDeck()
    },
    reporting: {
      cards: createCampaignScorecardReportCards(),
      packets: createCampaignScorecardReviewPackets(),
      summary: summarizeCampaignScorecardReporting()
    },
    audit: {
      trail: createCampaignScorecardAuditTrail(),
      manifest: createCampaignScorecardEvidenceManifest(),
      attestation: createCampaignScorecardReadinessAttestation()
    },
    playbooks: createCampaignScorecardPlaybooks(),
    decisions: createCampaignScorecardDecisionDeck(),
    escalationMoments: createCampaignScorecardEscalationMoments()
  };
}

export function createCampaignScorecardReadinessBoard(snapshot = buildCampaignScorecardSnapshot()) {
  return [
    { id: 'campaign-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignScorecardApiDocument(snapshot = buildCampaignScorecardSnapshot()) {
  return {
    id: 'campaign-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-scorecard/overview' },
      { method: 'GET', path: '/api/campaign-scorecard/reporting' },
      { method: 'POST', path: '/api/campaign-scorecard/validate' },
      { method: 'GET', path: '/api/campaign-scorecard/audit' }
    ],
    readiness: createCampaignScorecardReadinessBoard(snapshot)
  };
}

export function createCampaignScorecardRouteSummary(snapshot = buildCampaignScorecardSnapshot()) {
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

