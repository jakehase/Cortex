import { createCampaignVaultWorkspace, summarizeCampaignVaultWorkspace, createCampaignVaultNarratives, createCampaignVaultCoverageGrid } from './domain-campaign-vault.mjs';
import { createCampaignVaultPolicies, validateCampaignVaultPolicies, summarizeCampaignVaultPolicies, createCampaignVaultEscalationDeck } from './policies-campaign-vault.mjs';
import { createCampaignVaultAnalyticsTimeline, createCampaignVaultForecastEnvelope, createCampaignVaultExceptionLedger, summarizeCampaignVaultAnalytics } from './analytics-campaign-vault.mjs';
import { createCampaignVaultOperationsBoard, createCampaignVaultShiftChecklist, createCampaignVaultIncidentDeck } from './operations-campaign-vault.mjs';
import { createCampaignVaultReportCards, createCampaignVaultReviewPackets, summarizeCampaignVaultReporting } from './reporting-campaign-vault.mjs';
import { createCampaignVaultAuditTrail, createCampaignVaultEvidenceManifest, createCampaignVaultReadinessAttestation } from './audit-campaign-vault.mjs';
import { createCampaignVaultPlaybooks, createCampaignVaultDecisionDeck, createCampaignVaultEscalationMoments } from './playbooks-campaign-vault.mjs';

export function buildCampaignVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignVaultWorkspace(workspaceName);
  const policies = createCampaignVaultPolicies();
  return {
    workspace,
    summary: summarizeCampaignVaultWorkspace(workspace),
    narratives: createCampaignVaultNarratives(workspace),
    coverage: createCampaignVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignVaultPolicies(policies),
    validation: validateCampaignVaultPolicies(policies),
    escalationDeck: createCampaignVaultEscalationDeck(policies),
    analytics: {
      timeline: createCampaignVaultAnalyticsTimeline(),
      forecast: createCampaignVaultForecastEnvelope(),
      exceptions: createCampaignVaultExceptionLedger(),
      summary: summarizeCampaignVaultAnalytics()
    },
    operations: {
      board: createCampaignVaultOperationsBoard(),
      checklist: createCampaignVaultShiftChecklist(),
      incidents: createCampaignVaultIncidentDeck()
    },
    reporting: {
      cards: createCampaignVaultReportCards(),
      packets: createCampaignVaultReviewPackets(),
      summary: summarizeCampaignVaultReporting()
    },
    audit: {
      trail: createCampaignVaultAuditTrail(),
      manifest: createCampaignVaultEvidenceManifest(),
      attestation: createCampaignVaultReadinessAttestation()
    },
    playbooks: createCampaignVaultPlaybooks(),
    decisions: createCampaignVaultDecisionDeck(),
    escalationMoments: createCampaignVaultEscalationMoments()
  };
}

export function createCampaignVaultReadinessBoard(snapshot = buildCampaignVaultSnapshot()) {
  return [
    { id: 'campaign-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignVaultApiDocument(snapshot = buildCampaignVaultSnapshot()) {
  return {
    id: 'campaign-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-vault/overview' },
      { method: 'GET', path: '/api/campaign-vault/reporting' },
      { method: 'POST', path: '/api/campaign-vault/validate' },
      { method: 'GET', path: '/api/campaign-vault/audit' }
    ],
    readiness: createCampaignVaultReadinessBoard(snapshot)
  };
}

export function createCampaignVaultRouteSummary(snapshot = buildCampaignVaultSnapshot()) {
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

