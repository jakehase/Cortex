import { createCampaignConsoleWorkspace, summarizeCampaignConsoleWorkspace, createCampaignConsoleNarratives, createCampaignConsoleCoverageGrid } from './domain-campaign-console.mjs';
import { createCampaignConsolePolicies, validateCampaignConsolePolicies, summarizeCampaignConsolePolicies, createCampaignConsoleEscalationDeck } from './policies-campaign-console.mjs';
import { createCampaignConsoleAnalyticsTimeline, createCampaignConsoleForecastEnvelope, createCampaignConsoleExceptionLedger, summarizeCampaignConsoleAnalytics } from './analytics-campaign-console.mjs';
import { createCampaignConsoleOperationsBoard, createCampaignConsoleShiftChecklist, createCampaignConsoleIncidentDeck } from './operations-campaign-console.mjs';
import { createCampaignConsoleReportCards, createCampaignConsoleReviewPackets, summarizeCampaignConsoleReporting } from './reporting-campaign-console.mjs';
import { createCampaignConsoleAuditTrail, createCampaignConsoleEvidenceManifest, createCampaignConsoleReadinessAttestation } from './audit-campaign-console.mjs';
import { createCampaignConsolePlaybooks, createCampaignConsoleDecisionDeck, createCampaignConsoleEscalationMoments } from './playbooks-campaign-console.mjs';

export function buildCampaignConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCampaignConsoleWorkspace(workspaceName);
  const policies = createCampaignConsolePolicies();
  return {
    workspace,
    summary: summarizeCampaignConsoleWorkspace(workspace),
    narratives: createCampaignConsoleNarratives(workspace),
    coverage: createCampaignConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeCampaignConsolePolicies(policies),
    validation: validateCampaignConsolePolicies(policies),
    escalationDeck: createCampaignConsoleEscalationDeck(policies),
    analytics: {
      timeline: createCampaignConsoleAnalyticsTimeline(),
      forecast: createCampaignConsoleForecastEnvelope(),
      exceptions: createCampaignConsoleExceptionLedger(),
      summary: summarizeCampaignConsoleAnalytics()
    },
    operations: {
      board: createCampaignConsoleOperationsBoard(),
      checklist: createCampaignConsoleShiftChecklist(),
      incidents: createCampaignConsoleIncidentDeck()
    },
    reporting: {
      cards: createCampaignConsoleReportCards(),
      packets: createCampaignConsoleReviewPackets(),
      summary: summarizeCampaignConsoleReporting()
    },
    audit: {
      trail: createCampaignConsoleAuditTrail(),
      manifest: createCampaignConsoleEvidenceManifest(),
      attestation: createCampaignConsoleReadinessAttestation()
    },
    playbooks: createCampaignConsolePlaybooks(),
    decisions: createCampaignConsoleDecisionDeck(),
    escalationMoments: createCampaignConsoleEscalationMoments()
  };
}

export function createCampaignConsoleReadinessBoard(snapshot = buildCampaignConsoleSnapshot()) {
  return [
    { id: 'campaign-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'campaign-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'campaign-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'campaign-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCampaignConsoleApiDocument(snapshot = buildCampaignConsoleSnapshot()) {
  return {
    id: 'campaign-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/campaign-console/overview' },
      { method: 'GET', path: '/api/campaign-console/reporting' },
      { method: 'POST', path: '/api/campaign-console/validate' },
      { method: 'GET', path: '/api/campaign-console/audit' }
    ],
    readiness: createCampaignConsoleReadinessBoard(snapshot)
  };
}

export function createCampaignConsoleRouteSummary(snapshot = buildCampaignConsoleSnapshot()) {
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

