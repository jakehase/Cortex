import { createCampaignExchangeWorkspace, summarizeCampaignExchangeWorkspace, createCampaignExchangeNarratives, createCampaignExchangeCoverageGrid } from './domain-campaign-exchange.mjs';
import { createCampaignExchangePolicies, validateCampaignExchangePolicies, summarizeCampaignExchangePolicies, createCampaignExchangeEscalationDeck } from './policies-campaign-exchange.mjs';
import { createCampaignExchangeAnalyticsTimeline, createCampaignExchangeForecastEnvelope, createCampaignExchangeExceptionLedger, summarizeCampaignExchangeAnalytics } from './analytics-campaign-exchange.mjs';
import { createCampaignExchangeOperationsBoard, createCampaignExchangeShiftChecklist, createCampaignExchangeIncidentDeck } from './operations-campaign-exchange.mjs';
import { createCampaignExchangeReportCards, createCampaignExchangeReviewPackets, summarizeCampaignExchangeReporting } from './reporting-campaign-exchange.mjs';
import { createCampaignExchangeAuditTrail, createCampaignExchangeEvidenceManifest, createCampaignExchangeReadinessAttestation } from './audit-campaign-exchange.mjs';
import { createCampaignExchangePlaybooks, createCampaignExchangeDecisionDeck, createCampaignExchangeEscalationMoments } from './playbooks-campaign-exchange.mjs';

export function buildCampaignExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignExchangeWorkspace(workspaceName);
  const policies = createCampaignExchangePolicies();
  return {
    workspace,
    summary: summarizeCampaignExchangeWorkspace(workspace),
    narratives: createCampaignExchangeNarratives(workspace),
    coverage: createCampaignExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignExchangePolicies(policies),
    validation: validateCampaignExchangePolicies(policies),
    escalationDeck: createCampaignExchangeEscalationDeck(policies),
    analytics: {
      timeline: createCampaignExchangeAnalyticsTimeline(),
      forecast: createCampaignExchangeForecastEnvelope(),
      exceptions: createCampaignExchangeExceptionLedger(),
      summary: summarizeCampaignExchangeAnalytics()
    },
    operations: {
      board: createCampaignExchangeOperationsBoard(),
      checklist: createCampaignExchangeShiftChecklist(),
      incidents: createCampaignExchangeIncidentDeck()
    },
    reporting: {
      cards: createCampaignExchangeReportCards(),
      packets: createCampaignExchangeReviewPackets(),
      summary: summarizeCampaignExchangeReporting()
    },
    audit: {
      trail: createCampaignExchangeAuditTrail(),
      manifest: createCampaignExchangeEvidenceManifest(),
      attestation: createCampaignExchangeReadinessAttestation()
    },
    playbooks: createCampaignExchangePlaybooks(),
    decisions: createCampaignExchangeDecisionDeck(),
    escalationMoments: createCampaignExchangeEscalationMoments()
  };
}

export function createCampaignExchangeReadinessBoard(snapshot = buildCampaignExchangeSnapshot()) {
  return [
    { id: 'campaign-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignExchangeApiDocument(snapshot = buildCampaignExchangeSnapshot()) {
  return {
    id: 'campaign-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-exchange/overview' },
      { method: 'GET', path: '/api/campaign-exchange/reporting' },
      { method: 'POST', path: '/api/campaign-exchange/validate' },
      { method: 'GET', path: '/api/campaign-exchange/audit' }
    ],
    readiness: createCampaignExchangeReadinessBoard(snapshot)
  };
}

export function createCampaignExchangeRouteSummary(snapshot = buildCampaignExchangeSnapshot()) {
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

