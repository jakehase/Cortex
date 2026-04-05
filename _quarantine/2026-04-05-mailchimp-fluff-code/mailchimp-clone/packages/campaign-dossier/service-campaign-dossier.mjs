import { createCampaignDossierWorkspace, summarizeCampaignDossierWorkspace, createCampaignDossierNarratives, createCampaignDossierCoverageGrid } from './domain-campaign-dossier.mjs';
import { createCampaignDossierPolicies, validateCampaignDossierPolicies, summarizeCampaignDossierPolicies, createCampaignDossierEscalationDeck } from './policies-campaign-dossier.mjs';
import { createCampaignDossierAnalyticsTimeline, createCampaignDossierForecastEnvelope, createCampaignDossierExceptionLedger, summarizeCampaignDossierAnalytics } from './analytics-campaign-dossier.mjs';
import { createCampaignDossierOperationsBoard, createCampaignDossierShiftChecklist, createCampaignDossierIncidentDeck } from './operations-campaign-dossier.mjs';
import { createCampaignDossierReportCards, createCampaignDossierReviewPackets, summarizeCampaignDossierReporting } from './reporting-campaign-dossier.mjs';
import { createCampaignDossierAuditTrail, createCampaignDossierEvidenceManifest, createCampaignDossierReadinessAttestation } from './audit-campaign-dossier.mjs';
import { createCampaignDossierPlaybooks, createCampaignDossierDecisionDeck, createCampaignDossierEscalationMoments } from './playbooks-campaign-dossier.mjs';

export function buildCampaignDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignDossierWorkspace(workspaceName);
  const policies = createCampaignDossierPolicies();
  return {
    workspace,
    summary: summarizeCampaignDossierWorkspace(workspace),
    narratives: createCampaignDossierNarratives(workspace),
    coverage: createCampaignDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignDossierPolicies(policies),
    validation: validateCampaignDossierPolicies(policies),
    escalationDeck: createCampaignDossierEscalationDeck(policies),
    analytics: {
      timeline: createCampaignDossierAnalyticsTimeline(),
      forecast: createCampaignDossierForecastEnvelope(),
      exceptions: createCampaignDossierExceptionLedger(),
      summary: summarizeCampaignDossierAnalytics()
    },
    operations: {
      board: createCampaignDossierOperationsBoard(),
      checklist: createCampaignDossierShiftChecklist(),
      incidents: createCampaignDossierIncidentDeck()
    },
    reporting: {
      cards: createCampaignDossierReportCards(),
      packets: createCampaignDossierReviewPackets(),
      summary: summarizeCampaignDossierReporting()
    },
    audit: {
      trail: createCampaignDossierAuditTrail(),
      manifest: createCampaignDossierEvidenceManifest(),
      attestation: createCampaignDossierReadinessAttestation()
    },
    playbooks: createCampaignDossierPlaybooks(),
    decisions: createCampaignDossierDecisionDeck(),
    escalationMoments: createCampaignDossierEscalationMoments()
  };
}

export function createCampaignDossierReadinessBoard(snapshot = buildCampaignDossierSnapshot()) {
  return [
    { id: 'campaign-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignDossierApiDocument(snapshot = buildCampaignDossierSnapshot()) {
  return {
    id: 'campaign-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-dossier/overview' },
      { method: 'GET', path: '/api/campaign-dossier/reporting' },
      { method: 'POST', path: '/api/campaign-dossier/validate' },
      { method: 'GET', path: '/api/campaign-dossier/audit' }
    ],
    readiness: createCampaignDossierReadinessBoard(snapshot)
  };
}

export function createCampaignDossierRouteSummary(snapshot = buildCampaignDossierSnapshot()) {
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

