import { createCampaignNavigatorWorkspace, summarizeCampaignNavigatorWorkspace, createCampaignNavigatorNarratives, createCampaignNavigatorCoverageGrid } from './domain-campaign-navigator.mjs';
import { createCampaignNavigatorPolicies, validateCampaignNavigatorPolicies, summarizeCampaignNavigatorPolicies, createCampaignNavigatorEscalationDeck } from './policies-campaign-navigator.mjs';
import { createCampaignNavigatorAnalyticsTimeline, createCampaignNavigatorForecastEnvelope, createCampaignNavigatorExceptionLedger, summarizeCampaignNavigatorAnalytics } from './analytics-campaign-navigator.mjs';
import { createCampaignNavigatorOperationsBoard, createCampaignNavigatorShiftChecklist, createCampaignNavigatorIncidentDeck } from './operations-campaign-navigator.mjs';
import { createCampaignNavigatorReportCards, createCampaignNavigatorReviewPackets, summarizeCampaignNavigatorReporting } from './reporting-campaign-navigator.mjs';
import { createCampaignNavigatorAuditTrail, createCampaignNavigatorEvidenceManifest, createCampaignNavigatorReadinessAttestation } from './audit-campaign-navigator.mjs';
import { createCampaignNavigatorPlaybooks, createCampaignNavigatorDecisionDeck, createCampaignNavigatorEscalationMoments } from './playbooks-campaign-navigator.mjs';

export function buildCampaignNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignNavigatorWorkspace(workspaceName);
  const policies = createCampaignNavigatorPolicies();
  return {
    workspace,
    summary: summarizeCampaignNavigatorWorkspace(workspace),
    narratives: createCampaignNavigatorNarratives(workspace),
    coverage: createCampaignNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignNavigatorPolicies(policies),
    validation: validateCampaignNavigatorPolicies(policies),
    escalationDeck: createCampaignNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createCampaignNavigatorAnalyticsTimeline(),
      forecast: createCampaignNavigatorForecastEnvelope(),
      exceptions: createCampaignNavigatorExceptionLedger(),
      summary: summarizeCampaignNavigatorAnalytics()
    },
    operations: {
      board: createCampaignNavigatorOperationsBoard(),
      checklist: createCampaignNavigatorShiftChecklist(),
      incidents: createCampaignNavigatorIncidentDeck()
    },
    reporting: {
      cards: createCampaignNavigatorReportCards(),
      packets: createCampaignNavigatorReviewPackets(),
      summary: summarizeCampaignNavigatorReporting()
    },
    audit: {
      trail: createCampaignNavigatorAuditTrail(),
      manifest: createCampaignNavigatorEvidenceManifest(),
      attestation: createCampaignNavigatorReadinessAttestation()
    },
    playbooks: createCampaignNavigatorPlaybooks(),
    decisions: createCampaignNavigatorDecisionDeck(),
    escalationMoments: createCampaignNavigatorEscalationMoments()
  };
}

export function createCampaignNavigatorReadinessBoard(snapshot = buildCampaignNavigatorSnapshot()) {
  return [
    { id: 'campaign-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignNavigatorApiDocument(snapshot = buildCampaignNavigatorSnapshot()) {
  return {
    id: 'campaign-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-navigator/overview' },
      { method: 'GET', path: '/api/campaign-navigator/reporting' },
      { method: 'POST', path: '/api/campaign-navigator/validate' },
      { method: 'GET', path: '/api/campaign-navigator/audit' }
    ],
    readiness: createCampaignNavigatorReadinessBoard(snapshot)
  };
}

export function createCampaignNavigatorRouteSummary(snapshot = buildCampaignNavigatorSnapshot()) {
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

