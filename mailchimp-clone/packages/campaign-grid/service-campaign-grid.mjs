import { createCampaignGridWorkspace, summarizeCampaignGridWorkspace, createCampaignGridNarratives, createCampaignGridCoverageGrid } from './domain-campaign-grid.mjs';
import { createCampaignGridPolicies, validateCampaignGridPolicies, summarizeCampaignGridPolicies, createCampaignGridEscalationDeck } from './policies-campaign-grid.mjs';
import { createCampaignGridAnalyticsTimeline, createCampaignGridForecastEnvelope, createCampaignGridExceptionLedger, summarizeCampaignGridAnalytics } from './analytics-campaign-grid.mjs';
import { createCampaignGridOperationsBoard, createCampaignGridShiftChecklist, createCampaignGridIncidentDeck } from './operations-campaign-grid.mjs';
import { createCampaignGridReportCards, createCampaignGridReviewPackets, summarizeCampaignGridReporting } from './reporting-campaign-grid.mjs';
import { createCampaignGridAuditTrail, createCampaignGridEvidenceManifest, createCampaignGridReadinessAttestation } from './audit-campaign-grid.mjs';
import { createCampaignGridPlaybooks, createCampaignGridDecisionDeck, createCampaignGridEscalationMoments } from './playbooks-campaign-grid.mjs';

export function buildCampaignGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignGridWorkspace(workspaceName);
  const policies = createCampaignGridPolicies();
  return {
    workspace,
    summary: summarizeCampaignGridWorkspace(workspace),
    narratives: createCampaignGridNarratives(workspace),
    coverage: createCampaignGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignGridPolicies(policies),
    validation: validateCampaignGridPolicies(policies),
    escalationDeck: createCampaignGridEscalationDeck(policies),
    analytics: {
      timeline: createCampaignGridAnalyticsTimeline(),
      forecast: createCampaignGridForecastEnvelope(),
      exceptions: createCampaignGridExceptionLedger(),
      summary: summarizeCampaignGridAnalytics()
    },
    operations: {
      board: createCampaignGridOperationsBoard(),
      checklist: createCampaignGridShiftChecklist(),
      incidents: createCampaignGridIncidentDeck()
    },
    reporting: {
      cards: createCampaignGridReportCards(),
      packets: createCampaignGridReviewPackets(),
      summary: summarizeCampaignGridReporting()
    },
    audit: {
      trail: createCampaignGridAuditTrail(),
      manifest: createCampaignGridEvidenceManifest(),
      attestation: createCampaignGridReadinessAttestation()
    },
    playbooks: createCampaignGridPlaybooks(),
    decisions: createCampaignGridDecisionDeck(),
    escalationMoments: createCampaignGridEscalationMoments()
  };
}

export function createCampaignGridReadinessBoard(snapshot = buildCampaignGridSnapshot()) {
  return [
    { id: 'campaign-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignGridApiDocument(snapshot = buildCampaignGridSnapshot()) {
  return {
    id: 'campaign-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-grid/overview' },
      { method: 'GET', path: '/api/campaign-grid/reporting' },
      { method: 'POST', path: '/api/campaign-grid/validate' },
      { method: 'GET', path: '/api/campaign-grid/audit' }
    ],
    readiness: createCampaignGridReadinessBoard(snapshot)
  };
}

export function createCampaignGridRouteSummary(snapshot = buildCampaignGridSnapshot()) {
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

