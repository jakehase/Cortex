import { createCampaignNotebookWorkspace, summarizeCampaignNotebookWorkspace, createCampaignNotebookNarratives, createCampaignNotebookCoverageGrid } from './domain-campaign-notebook.mjs';
import { createCampaignNotebookPolicies, validateCampaignNotebookPolicies, summarizeCampaignNotebookPolicies, createCampaignNotebookEscalationDeck } from './policies-campaign-notebook.mjs';
import { createCampaignNotebookAnalyticsTimeline, createCampaignNotebookForecastEnvelope, createCampaignNotebookExceptionLedger, summarizeCampaignNotebookAnalytics } from './analytics-campaign-notebook.mjs';
import { createCampaignNotebookOperationsBoard, createCampaignNotebookShiftChecklist, createCampaignNotebookIncidentDeck } from './operations-campaign-notebook.mjs';
import { createCampaignNotebookReportCards, createCampaignNotebookReviewPackets, summarizeCampaignNotebookReporting } from './reporting-campaign-notebook.mjs';
import { createCampaignNotebookAuditTrail, createCampaignNotebookEvidenceManifest, createCampaignNotebookReadinessAttestation } from './audit-campaign-notebook.mjs';
import { createCampaignNotebookPlaybooks, createCampaignNotebookDecisionDeck, createCampaignNotebookEscalationMoments } from './playbooks-campaign-notebook.mjs';

export function buildCampaignNotebookSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignNotebookWorkspace(workspaceName);
  const policies = createCampaignNotebookPolicies();
  return {
    workspace,
    summary: summarizeCampaignNotebookWorkspace(workspace),
    narratives: createCampaignNotebookNarratives(workspace),
    coverage: createCampaignNotebookCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignNotebookPolicies(policies),
    validation: validateCampaignNotebookPolicies(policies),
    escalationDeck: createCampaignNotebookEscalationDeck(policies),
    analytics: {
      timeline: createCampaignNotebookAnalyticsTimeline(),
      forecast: createCampaignNotebookForecastEnvelope(),
      exceptions: createCampaignNotebookExceptionLedger(),
      summary: summarizeCampaignNotebookAnalytics()
    },
    operations: {
      board: createCampaignNotebookOperationsBoard(),
      checklist: createCampaignNotebookShiftChecklist(),
      incidents: createCampaignNotebookIncidentDeck()
    },
    reporting: {
      cards: createCampaignNotebookReportCards(),
      packets: createCampaignNotebookReviewPackets(),
      summary: summarizeCampaignNotebookReporting()
    },
    audit: {
      trail: createCampaignNotebookAuditTrail(),
      manifest: createCampaignNotebookEvidenceManifest(),
      attestation: createCampaignNotebookReadinessAttestation()
    },
    playbooks: createCampaignNotebookPlaybooks(),
    decisions: createCampaignNotebookDecisionDeck(),
    escalationMoments: createCampaignNotebookEscalationMoments()
  };
}

export function createCampaignNotebookReadinessBoard(snapshot = buildCampaignNotebookSnapshot()) {
  return [
    { id: 'campaign-notebook-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-notebook-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-notebook-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-notebook-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignNotebookApiDocument(snapshot = buildCampaignNotebookSnapshot()) {
  return {
    id: 'campaign-notebook-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-notebook/overview' },
      { method: 'GET', path: '/api/campaign-notebook/reporting' },
      { method: 'POST', path: '/api/campaign-notebook/validate' },
      { method: 'GET', path: '/api/campaign-notebook/audit' }
    ],
    readiness: createCampaignNotebookReadinessBoard(snapshot)
  };
}

export function createCampaignNotebookRouteSummary(snapshot = buildCampaignNotebookSnapshot()) {
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

