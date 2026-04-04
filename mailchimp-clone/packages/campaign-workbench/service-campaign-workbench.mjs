import { createCampaignWorkbenchWorkspace, summarizeCampaignWorkbenchWorkspace, createCampaignWorkbenchNarratives, createCampaignWorkbenchCoverageGrid } from './domain-campaign-workbench.mjs';
import { createCampaignWorkbenchPolicies, validateCampaignWorkbenchPolicies, summarizeCampaignWorkbenchPolicies, createCampaignWorkbenchEscalationDeck } from './policies-campaign-workbench.mjs';
import { createCampaignWorkbenchAnalyticsTimeline, createCampaignWorkbenchForecastEnvelope, createCampaignWorkbenchExceptionLedger, summarizeCampaignWorkbenchAnalytics } from './analytics-campaign-workbench.mjs';
import { createCampaignWorkbenchOperationsBoard, createCampaignWorkbenchShiftChecklist, createCampaignWorkbenchIncidentDeck } from './operations-campaign-workbench.mjs';
import { createCampaignWorkbenchReportCards, createCampaignWorkbenchReviewPackets, summarizeCampaignWorkbenchReporting } from './reporting-campaign-workbench.mjs';
import { createCampaignWorkbenchAuditTrail, createCampaignWorkbenchEvidenceManifest, createCampaignWorkbenchReadinessAttestation } from './audit-campaign-workbench.mjs';
import { createCampaignWorkbenchPlaybooks, createCampaignWorkbenchDecisionDeck, createCampaignWorkbenchEscalationMoments } from './playbooks-campaign-workbench.mjs';

export function buildCampaignWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignWorkbenchWorkspace(workspaceName);
  const policies = createCampaignWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeCampaignWorkbenchWorkspace(workspace),
    narratives: createCampaignWorkbenchNarratives(workspace),
    coverage: createCampaignWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignWorkbenchPolicies(policies),
    validation: validateCampaignWorkbenchPolicies(policies),
    escalationDeck: createCampaignWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createCampaignWorkbenchAnalyticsTimeline(),
      forecast: createCampaignWorkbenchForecastEnvelope(),
      exceptions: createCampaignWorkbenchExceptionLedger(),
      summary: summarizeCampaignWorkbenchAnalytics()
    },
    operations: {
      board: createCampaignWorkbenchOperationsBoard(),
      checklist: createCampaignWorkbenchShiftChecklist(),
      incidents: createCampaignWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createCampaignWorkbenchReportCards(),
      packets: createCampaignWorkbenchReviewPackets(),
      summary: summarizeCampaignWorkbenchReporting()
    },
    audit: {
      trail: createCampaignWorkbenchAuditTrail(),
      manifest: createCampaignWorkbenchEvidenceManifest(),
      attestation: createCampaignWorkbenchReadinessAttestation()
    },
    playbooks: createCampaignWorkbenchPlaybooks(),
    decisions: createCampaignWorkbenchDecisionDeck(),
    escalationMoments: createCampaignWorkbenchEscalationMoments()
  };
}

export function createCampaignWorkbenchReadinessBoard(snapshot = buildCampaignWorkbenchSnapshot()) {
  return [
    { id: 'campaign-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignWorkbenchApiDocument(snapshot = buildCampaignWorkbenchSnapshot()) {
  return {
    id: 'campaign-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-workbench/overview' },
      { method: 'GET', path: '/api/campaign-workbench/reporting' },
      { method: 'POST', path: '/api/campaign-workbench/validate' },
      { method: 'GET', path: '/api/campaign-workbench/audit' }
    ],
    readiness: createCampaignWorkbenchReadinessBoard(snapshot)
  };
}

export function createCampaignWorkbenchRouteSummary(snapshot = buildCampaignWorkbenchSnapshot()) {
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

