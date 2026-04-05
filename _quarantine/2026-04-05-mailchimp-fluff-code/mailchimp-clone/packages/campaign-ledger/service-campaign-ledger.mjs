import { createCampaignLedgerWorkspace, summarizeCampaignLedgerWorkspace, createCampaignLedgerNarratives, createCampaignLedgerCoverageGrid } from './domain-campaign-ledger.mjs';
import { createCampaignLedgerPolicies, validateCampaignLedgerPolicies, summarizeCampaignLedgerPolicies, createCampaignLedgerEscalationDeck } from './policies-campaign-ledger.mjs';
import { createCampaignLedgerAnalyticsTimeline, createCampaignLedgerForecastEnvelope, createCampaignLedgerExceptionLedger, summarizeCampaignLedgerAnalytics } from './analytics-campaign-ledger.mjs';
import { createCampaignLedgerOperationsBoard, createCampaignLedgerShiftChecklist, createCampaignLedgerIncidentDeck } from './operations-campaign-ledger.mjs';
import { createCampaignLedgerReportCards, createCampaignLedgerReviewPackets, summarizeCampaignLedgerReporting } from './reporting-campaign-ledger.mjs';
import { createCampaignLedgerAuditTrail, createCampaignLedgerEvidenceManifest, createCampaignLedgerReadinessAttestation } from './audit-campaign-ledger.mjs';
import { createCampaignLedgerPlaybooks, createCampaignLedgerDecisionDeck, createCampaignLedgerEscalationMoments } from './playbooks-campaign-ledger.mjs';

export function buildCampaignLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignLedgerWorkspace(workspaceName);
  const policies = createCampaignLedgerPolicies();
  return {
    workspace,
    summary: summarizeCampaignLedgerWorkspace(workspace),
    narratives: createCampaignLedgerNarratives(workspace),
    coverage: createCampaignLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignLedgerPolicies(policies),
    validation: validateCampaignLedgerPolicies(policies),
    escalationDeck: createCampaignLedgerEscalationDeck(policies),
    analytics: {
      timeline: createCampaignLedgerAnalyticsTimeline(),
      forecast: createCampaignLedgerForecastEnvelope(),
      exceptions: createCampaignLedgerExceptionLedger(),
      summary: summarizeCampaignLedgerAnalytics()
    },
    operations: {
      board: createCampaignLedgerOperationsBoard(),
      checklist: createCampaignLedgerShiftChecklist(),
      incidents: createCampaignLedgerIncidentDeck()
    },
    reporting: {
      cards: createCampaignLedgerReportCards(),
      packets: createCampaignLedgerReviewPackets(),
      summary: summarizeCampaignLedgerReporting()
    },
    audit: {
      trail: createCampaignLedgerAuditTrail(),
      manifest: createCampaignLedgerEvidenceManifest(),
      attestation: createCampaignLedgerReadinessAttestation()
    },
    playbooks: createCampaignLedgerPlaybooks(),
    decisions: createCampaignLedgerDecisionDeck(),
    escalationMoments: createCampaignLedgerEscalationMoments()
  };
}

export function createCampaignLedgerReadinessBoard(snapshot = buildCampaignLedgerSnapshot()) {
  return [
    { id: 'campaign-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignLedgerApiDocument(snapshot = buildCampaignLedgerSnapshot()) {
  return {
    id: 'campaign-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-ledger/overview' },
      { method: 'GET', path: '/api/campaign-ledger/reporting' },
      { method: 'POST', path: '/api/campaign-ledger/validate' },
      { method: 'GET', path: '/api/campaign-ledger/audit' }
    ],
    readiness: createCampaignLedgerReadinessBoard(snapshot)
  };
}

export function createCampaignLedgerRouteSummary(snapshot = buildCampaignLedgerSnapshot()) {
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

