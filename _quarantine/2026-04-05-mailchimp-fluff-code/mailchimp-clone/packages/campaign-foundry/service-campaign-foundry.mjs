import { createCampaignFoundryWorkspace, summarizeCampaignFoundryWorkspace, createCampaignFoundryNarratives, createCampaignFoundryCoverageGrid } from './domain-campaign-foundry.mjs';
import { createCampaignFoundryPolicies, validateCampaignFoundryPolicies, summarizeCampaignFoundryPolicies, createCampaignFoundryEscalationDeck } from './policies-campaign-foundry.mjs';
import { createCampaignFoundryAnalyticsTimeline, createCampaignFoundryForecastEnvelope, createCampaignFoundryExceptionLedger, summarizeCampaignFoundryAnalytics } from './analytics-campaign-foundry.mjs';
import { createCampaignFoundryOperationsBoard, createCampaignFoundryShiftChecklist, createCampaignFoundryIncidentDeck } from './operations-campaign-foundry.mjs';
import { createCampaignFoundryReportCards, createCampaignFoundryReviewPackets, summarizeCampaignFoundryReporting } from './reporting-campaign-foundry.mjs';
import { createCampaignFoundryAuditTrail, createCampaignFoundryEvidenceManifest, createCampaignFoundryReadinessAttestation } from './audit-campaign-foundry.mjs';
import { createCampaignFoundryPlaybooks, createCampaignFoundryDecisionDeck, createCampaignFoundryEscalationMoments } from './playbooks-campaign-foundry.mjs';

export function buildCampaignFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignFoundryWorkspace(workspaceName);
  const policies = createCampaignFoundryPolicies();
  return {
    workspace,
    summary: summarizeCampaignFoundryWorkspace(workspace),
    narratives: createCampaignFoundryNarratives(workspace),
    coverage: createCampaignFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignFoundryPolicies(policies),
    validation: validateCampaignFoundryPolicies(policies),
    escalationDeck: createCampaignFoundryEscalationDeck(policies),
    analytics: {
      timeline: createCampaignFoundryAnalyticsTimeline(),
      forecast: createCampaignFoundryForecastEnvelope(),
      exceptions: createCampaignFoundryExceptionLedger(),
      summary: summarizeCampaignFoundryAnalytics()
    },
    operations: {
      board: createCampaignFoundryOperationsBoard(),
      checklist: createCampaignFoundryShiftChecklist(),
      incidents: createCampaignFoundryIncidentDeck()
    },
    reporting: {
      cards: createCampaignFoundryReportCards(),
      packets: createCampaignFoundryReviewPackets(),
      summary: summarizeCampaignFoundryReporting()
    },
    audit: {
      trail: createCampaignFoundryAuditTrail(),
      manifest: createCampaignFoundryEvidenceManifest(),
      attestation: createCampaignFoundryReadinessAttestation()
    },
    playbooks: createCampaignFoundryPlaybooks(),
    decisions: createCampaignFoundryDecisionDeck(),
    escalationMoments: createCampaignFoundryEscalationMoments()
  };
}

export function createCampaignFoundryReadinessBoard(snapshot = buildCampaignFoundrySnapshot()) {
  return [
    { id: 'campaign-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignFoundryApiDocument(snapshot = buildCampaignFoundrySnapshot()) {
  return {
    id: 'campaign-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-foundry/overview' },
      { method: 'GET', path: '/api/campaign-foundry/reporting' },
      { method: 'POST', path: '/api/campaign-foundry/validate' },
      { method: 'GET', path: '/api/campaign-foundry/audit' }
    ],
    readiness: createCampaignFoundryReadinessBoard(snapshot)
  };
}

export function createCampaignFoundryRouteSummary(snapshot = buildCampaignFoundrySnapshot()) {
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

