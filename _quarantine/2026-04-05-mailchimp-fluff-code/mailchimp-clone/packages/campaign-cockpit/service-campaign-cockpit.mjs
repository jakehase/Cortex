import { createCampaignCockpitWorkspace, summarizeCampaignCockpitWorkspace, createCampaignCockpitNarratives, createCampaignCockpitCoverageGrid } from './domain-campaign-cockpit.mjs';
import { createCampaignCockpitPolicies, validateCampaignCockpitPolicies, summarizeCampaignCockpitPolicies, createCampaignCockpitEscalationDeck } from './policies-campaign-cockpit.mjs';
import { createCampaignCockpitAnalyticsTimeline, createCampaignCockpitForecastEnvelope, createCampaignCockpitExceptionLedger, summarizeCampaignCockpitAnalytics } from './analytics-campaign-cockpit.mjs';
import { createCampaignCockpitOperationsBoard, createCampaignCockpitShiftChecklist, createCampaignCockpitIncidentDeck } from './operations-campaign-cockpit.mjs';
import { createCampaignCockpitReportCards, createCampaignCockpitReviewPackets, summarizeCampaignCockpitReporting } from './reporting-campaign-cockpit.mjs';
import { createCampaignCockpitAuditTrail, createCampaignCockpitEvidenceManifest, createCampaignCockpitReadinessAttestation } from './audit-campaign-cockpit.mjs';
import { createCampaignCockpitPlaybooks, createCampaignCockpitDecisionDeck, createCampaignCockpitEscalationMoments } from './playbooks-campaign-cockpit.mjs';

export function buildCampaignCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignCockpitWorkspace(workspaceName);
  const policies = createCampaignCockpitPolicies();
  return {
    workspace,
    summary: summarizeCampaignCockpitWorkspace(workspace),
    narratives: createCampaignCockpitNarratives(workspace),
    coverage: createCampaignCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignCockpitPolicies(policies),
    validation: validateCampaignCockpitPolicies(policies),
    escalationDeck: createCampaignCockpitEscalationDeck(policies),
    analytics: {
      timeline: createCampaignCockpitAnalyticsTimeline(),
      forecast: createCampaignCockpitForecastEnvelope(),
      exceptions: createCampaignCockpitExceptionLedger(),
      summary: summarizeCampaignCockpitAnalytics()
    },
    operations: {
      board: createCampaignCockpitOperationsBoard(),
      checklist: createCampaignCockpitShiftChecklist(),
      incidents: createCampaignCockpitIncidentDeck()
    },
    reporting: {
      cards: createCampaignCockpitReportCards(),
      packets: createCampaignCockpitReviewPackets(),
      summary: summarizeCampaignCockpitReporting()
    },
    audit: {
      trail: createCampaignCockpitAuditTrail(),
      manifest: createCampaignCockpitEvidenceManifest(),
      attestation: createCampaignCockpitReadinessAttestation()
    },
    playbooks: createCampaignCockpitPlaybooks(),
    decisions: createCampaignCockpitDecisionDeck(),
    escalationMoments: createCampaignCockpitEscalationMoments()
  };
}

export function createCampaignCockpitReadinessBoard(snapshot = buildCampaignCockpitSnapshot()) {
  return [
    { id: 'campaign-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignCockpitApiDocument(snapshot = buildCampaignCockpitSnapshot()) {
  return {
    id: 'campaign-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-cockpit/overview' },
      { method: 'GET', path: '/api/campaign-cockpit/reporting' },
      { method: 'POST', path: '/api/campaign-cockpit/validate' },
      { method: 'GET', path: '/api/campaign-cockpit/audit' }
    ],
    readiness: createCampaignCockpitReadinessBoard(snapshot)
  };
}

export function createCampaignCockpitRouteSummary(snapshot = buildCampaignCockpitSnapshot()) {
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

