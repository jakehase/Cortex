import { createCampaignPlannerWorkspace, summarizeCampaignPlannerWorkspace, createCampaignPlannerNarratives, createCampaignPlannerCoverageGrid } from './domain-campaign-planner.mjs';
import { createCampaignPlannerPolicies, validateCampaignPlannerPolicies, summarizeCampaignPlannerPolicies, createCampaignPlannerEscalationDeck } from './policies-campaign-planner.mjs';
import { createCampaignPlannerAnalyticsTimeline, createCampaignPlannerForecastEnvelope, createCampaignPlannerExceptionLedger, summarizeCampaignPlannerAnalytics } from './analytics-campaign-planner.mjs';
import { createCampaignPlannerOperationsBoard, createCampaignPlannerShiftChecklist, createCampaignPlannerIncidentDeck } from './operations-campaign-planner.mjs';
import { createCampaignPlannerReportCards, createCampaignPlannerReviewPackets, summarizeCampaignPlannerReporting } from './reporting-campaign-planner.mjs';
import { createCampaignPlannerAuditTrail, createCampaignPlannerEvidenceManifest, createCampaignPlannerReadinessAttestation } from './audit-campaign-planner.mjs';
import { createCampaignPlannerPlaybooks, createCampaignPlannerDecisionDeck, createCampaignPlannerEscalationMoments } from './playbooks-campaign-planner.mjs';

export function buildCampaignPlannerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignPlannerWorkspace(workspaceName);
  const policies = createCampaignPlannerPolicies();
  return {
    workspace,
    summary: summarizeCampaignPlannerWorkspace(workspace),
    narratives: createCampaignPlannerNarratives(workspace),
    coverage: createCampaignPlannerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignPlannerPolicies(policies),
    validation: validateCampaignPlannerPolicies(policies),
    escalationDeck: createCampaignPlannerEscalationDeck(policies),
    analytics: {
      timeline: createCampaignPlannerAnalyticsTimeline(),
      forecast: createCampaignPlannerForecastEnvelope(),
      exceptions: createCampaignPlannerExceptionLedger(),
      summary: summarizeCampaignPlannerAnalytics()
    },
    operations: {
      board: createCampaignPlannerOperationsBoard(),
      checklist: createCampaignPlannerShiftChecklist(),
      incidents: createCampaignPlannerIncidentDeck()
    },
    reporting: {
      cards: createCampaignPlannerReportCards(),
      packets: createCampaignPlannerReviewPackets(),
      summary: summarizeCampaignPlannerReporting()
    },
    audit: {
      trail: createCampaignPlannerAuditTrail(),
      manifest: createCampaignPlannerEvidenceManifest(),
      attestation: createCampaignPlannerReadinessAttestation()
    },
    playbooks: createCampaignPlannerPlaybooks(),
    decisions: createCampaignPlannerDecisionDeck(),
    escalationMoments: createCampaignPlannerEscalationMoments()
  };
}

export function createCampaignPlannerReadinessBoard(snapshot = buildCampaignPlannerSnapshot()) {
  return [
    { id: 'campaign-planner-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-planner-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-planner-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-planner-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignPlannerApiDocument(snapshot = buildCampaignPlannerSnapshot()) {
  return {
    id: 'campaign-planner-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-planner/overview' },
      { method: 'GET', path: '/api/campaign-planner/reporting' },
      { method: 'POST', path: '/api/campaign-planner/validate' },
      { method: 'GET', path: '/api/campaign-planner/audit' }
    ],
    readiness: createCampaignPlannerReadinessBoard(snapshot)
  };
}

export function createCampaignPlannerRouteSummary(snapshot = buildCampaignPlannerSnapshot()) {
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

