import { createCampaignAtlasWorkspace, summarizeCampaignAtlasWorkspace, createCampaignAtlasNarratives, createCampaignAtlasCoverageGrid } from './domain-campaign-atlas.mjs';
import { createCampaignAtlasPolicies, validateCampaignAtlasPolicies, summarizeCampaignAtlasPolicies, createCampaignAtlasEscalationDeck } from './policies-campaign-atlas.mjs';
import { createCampaignAtlasAnalyticsTimeline, createCampaignAtlasForecastEnvelope, createCampaignAtlasExceptionLedger, summarizeCampaignAtlasAnalytics } from './analytics-campaign-atlas.mjs';
import { createCampaignAtlasOperationsBoard, createCampaignAtlasShiftChecklist, createCampaignAtlasIncidentDeck } from './operations-campaign-atlas.mjs';
import { createCampaignAtlasReportCards, createCampaignAtlasReviewPackets, summarizeCampaignAtlasReporting } from './reporting-campaign-atlas.mjs';
import { createCampaignAtlasAuditTrail, createCampaignAtlasEvidenceManifest, createCampaignAtlasReadinessAttestation } from './audit-campaign-atlas.mjs';
import { createCampaignAtlasPlaybooks, createCampaignAtlasDecisionDeck, createCampaignAtlasEscalationMoments } from './playbooks-campaign-atlas.mjs';

export function buildCampaignAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignAtlasWorkspace(workspaceName);
  const policies = createCampaignAtlasPolicies();
  return {
    workspace,
    summary: summarizeCampaignAtlasWorkspace(workspace),
    narratives: createCampaignAtlasNarratives(workspace),
    coverage: createCampaignAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignAtlasPolicies(policies),
    validation: validateCampaignAtlasPolicies(policies),
    escalationDeck: createCampaignAtlasEscalationDeck(policies),
    analytics: {
      timeline: createCampaignAtlasAnalyticsTimeline(),
      forecast: createCampaignAtlasForecastEnvelope(),
      exceptions: createCampaignAtlasExceptionLedger(),
      summary: summarizeCampaignAtlasAnalytics()
    },
    operations: {
      board: createCampaignAtlasOperationsBoard(),
      checklist: createCampaignAtlasShiftChecklist(),
      incidents: createCampaignAtlasIncidentDeck()
    },
    reporting: {
      cards: createCampaignAtlasReportCards(),
      packets: createCampaignAtlasReviewPackets(),
      summary: summarizeCampaignAtlasReporting()
    },
    audit: {
      trail: createCampaignAtlasAuditTrail(),
      manifest: createCampaignAtlasEvidenceManifest(),
      attestation: createCampaignAtlasReadinessAttestation()
    },
    playbooks: createCampaignAtlasPlaybooks(),
    decisions: createCampaignAtlasDecisionDeck(),
    escalationMoments: createCampaignAtlasEscalationMoments()
  };
}

export function createCampaignAtlasReadinessBoard(snapshot = buildCampaignAtlasSnapshot()) {
  return [
    { id: 'campaign-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignAtlasApiDocument(snapshot = buildCampaignAtlasSnapshot()) {
  return {
    id: 'campaign-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-atlas/overview' },
      { method: 'GET', path: '/api/campaign-atlas/reporting' },
      { method: 'POST', path: '/api/campaign-atlas/validate' },
      { method: 'GET', path: '/api/campaign-atlas/audit' }
    ],
    readiness: createCampaignAtlasReadinessBoard(snapshot)
  };
}

export function createCampaignAtlasRouteSummary(snapshot = buildCampaignAtlasSnapshot()) {
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

