import { createCampaignAdvisorWorkspace, summarizeCampaignAdvisorWorkspace, createCampaignAdvisorNarratives, createCampaignAdvisorCoverageGrid } from './domain-campaign-advisor.mjs';
import { createCampaignAdvisorPolicies, validateCampaignAdvisorPolicies, summarizeCampaignAdvisorPolicies, createCampaignAdvisorEscalationDeck } from './policies-campaign-advisor.mjs';
import { createCampaignAdvisorAnalyticsTimeline, createCampaignAdvisorForecastEnvelope, createCampaignAdvisorExceptionLedger, summarizeCampaignAdvisorAnalytics } from './analytics-campaign-advisor.mjs';
import { createCampaignAdvisorOperationsBoard, createCampaignAdvisorShiftChecklist, createCampaignAdvisorIncidentDeck } from './operations-campaign-advisor.mjs';
import { createCampaignAdvisorReportCards, createCampaignAdvisorReviewPackets, summarizeCampaignAdvisorReporting } from './reporting-campaign-advisor.mjs';
import { createCampaignAdvisorAuditTrail, createCampaignAdvisorEvidenceManifest, createCampaignAdvisorReadinessAttestation } from './audit-campaign-advisor.mjs';
import { createCampaignAdvisorPlaybooks, createCampaignAdvisorDecisionDeck, createCampaignAdvisorEscalationMoments } from './playbooks-campaign-advisor.mjs';

export function buildCampaignAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignAdvisorWorkspace(workspaceName);
  const policies = createCampaignAdvisorPolicies();
  return {
    workspace,
    summary: summarizeCampaignAdvisorWorkspace(workspace),
    narratives: createCampaignAdvisorNarratives(workspace),
    coverage: createCampaignAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignAdvisorPolicies(policies),
    validation: validateCampaignAdvisorPolicies(policies),
    escalationDeck: createCampaignAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createCampaignAdvisorAnalyticsTimeline(),
      forecast: createCampaignAdvisorForecastEnvelope(),
      exceptions: createCampaignAdvisorExceptionLedger(),
      summary: summarizeCampaignAdvisorAnalytics()
    },
    operations: {
      board: createCampaignAdvisorOperationsBoard(),
      checklist: createCampaignAdvisorShiftChecklist(),
      incidents: createCampaignAdvisorIncidentDeck()
    },
    reporting: {
      cards: createCampaignAdvisorReportCards(),
      packets: createCampaignAdvisorReviewPackets(),
      summary: summarizeCampaignAdvisorReporting()
    },
    audit: {
      trail: createCampaignAdvisorAuditTrail(),
      manifest: createCampaignAdvisorEvidenceManifest(),
      attestation: createCampaignAdvisorReadinessAttestation()
    },
    playbooks: createCampaignAdvisorPlaybooks(),
    decisions: createCampaignAdvisorDecisionDeck(),
    escalationMoments: createCampaignAdvisorEscalationMoments()
  };
}

export function createCampaignAdvisorReadinessBoard(snapshot = buildCampaignAdvisorSnapshot()) {
  return [
    { id: 'campaign-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignAdvisorApiDocument(snapshot = buildCampaignAdvisorSnapshot()) {
  return {
    id: 'campaign-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-advisor/overview' },
      { method: 'GET', path: '/api/campaign-advisor/reporting' },
      { method: 'POST', path: '/api/campaign-advisor/validate' },
      { method: 'GET', path: '/api/campaign-advisor/audit' }
    ],
    readiness: createCampaignAdvisorReadinessBoard(snapshot)
  };
}

export function createCampaignAdvisorRouteSummary(snapshot = buildCampaignAdvisorSnapshot()) {
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

