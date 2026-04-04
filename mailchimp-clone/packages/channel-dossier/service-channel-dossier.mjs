import { createChannelDossierWorkspace, summarizeChannelDossierWorkspace, createChannelDossierNarratives, createChannelDossierCoverageGrid } from './domain-channel-dossier.mjs';
import { createChannelDossierPolicies, validateChannelDossierPolicies, summarizeChannelDossierPolicies, createChannelDossierEscalationDeck } from './policies-channel-dossier.mjs';
import { createChannelDossierAnalyticsTimeline, createChannelDossierForecastEnvelope, createChannelDossierExceptionLedger, summarizeChannelDossierAnalytics } from './analytics-channel-dossier.mjs';
import { createChannelDossierOperationsBoard, createChannelDossierShiftChecklist, createChannelDossierIncidentDeck } from './operations-channel-dossier.mjs';
import { createChannelDossierReportCards, createChannelDossierReviewPackets, summarizeChannelDossierReporting } from './reporting-channel-dossier.mjs';
import { createChannelDossierAuditTrail, createChannelDossierEvidenceManifest, createChannelDossierReadinessAttestation } from './audit-channel-dossier.mjs';
import { createChannelDossierPlaybooks, createChannelDossierDecisionDeck, createChannelDossierEscalationMoments } from './playbooks-channel-dossier.mjs';

export function buildChannelDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelDossierWorkspace(workspaceName);
  const policies = createChannelDossierPolicies();
  return {
    workspace,
    summary: summarizeChannelDossierWorkspace(workspace),
    narratives: createChannelDossierNarratives(workspace),
    coverage: createChannelDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelDossierPolicies(policies),
    validation: validateChannelDossierPolicies(policies),
    escalationDeck: createChannelDossierEscalationDeck(policies),
    analytics: {
      timeline: createChannelDossierAnalyticsTimeline(),
      forecast: createChannelDossierForecastEnvelope(),
      exceptions: createChannelDossierExceptionLedger(),
      summary: summarizeChannelDossierAnalytics()
    },
    operations: {
      board: createChannelDossierOperationsBoard(),
      checklist: createChannelDossierShiftChecklist(),
      incidents: createChannelDossierIncidentDeck()
    },
    reporting: {
      cards: createChannelDossierReportCards(),
      packets: createChannelDossierReviewPackets(),
      summary: summarizeChannelDossierReporting()
    },
    audit: {
      trail: createChannelDossierAuditTrail(),
      manifest: createChannelDossierEvidenceManifest(),
      attestation: createChannelDossierReadinessAttestation()
    },
    playbooks: createChannelDossierPlaybooks(),
    decisions: createChannelDossierDecisionDeck(),
    escalationMoments: createChannelDossierEscalationMoments()
  };
}

export function createChannelDossierReadinessBoard(snapshot = buildChannelDossierSnapshot()) {
  return [
    { id: 'channel-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelDossierApiDocument(snapshot = buildChannelDossierSnapshot()) {
  return {
    id: 'channel-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-dossier/overview' },
      { method: 'GET', path: '/api/channel-dossier/reporting' },
      { method: 'POST', path: '/api/channel-dossier/validate' },
      { method: 'GET', path: '/api/channel-dossier/audit' }
    ],
    readiness: createChannelDossierReadinessBoard(snapshot)
  };
}

export function createChannelDossierRouteSummary(snapshot = buildChannelDossierSnapshot()) {
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

