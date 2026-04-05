import { createLocalizationHubWorkspace, summarizeLocalizationHubWorkspace, createLocalizationHubNarratives, createLocalizationHubCoverageGrid } from './domain-localization-hub.mjs';
import { createLocalizationHubPolicies, validateLocalizationHubPolicies, summarizeLocalizationHubPolicies, createLocalizationHubEscalationDeck } from './policies-localization-hub.mjs';
import { createLocalizationHubAnalyticsTimeline, createLocalizationHubForecastEnvelope, createLocalizationHubExceptionLedger, summarizeLocalizationHubAnalytics } from './analytics-localization-hub.mjs';
import { createLocalizationHubOperationsBoard, createLocalizationHubShiftChecklist, createLocalizationHubIncidentDeck } from './operations-localization-hub.mjs';
import { createLocalizationHubReportCards, createLocalizationHubReviewPackets, summarizeLocalizationHubReporting } from './reporting-localization-hub.mjs';
import { createLocalizationHubAuditTrail, createLocalizationHubEvidenceManifest, createLocalizationHubReadinessAttestation } from './audit-localization-hub.mjs';
import { createLocalizationHubPlaybooks, createLocalizationHubDecisionDeck, createLocalizationHubEscalationMoments } from './playbooks-localization-hub.mjs';

export function buildLocalizationHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationHubWorkspace(workspaceName);
  const policies = createLocalizationHubPolicies();
  return {
    workspace,
    summary: summarizeLocalizationHubWorkspace(workspace),
    narratives: createLocalizationHubNarratives(workspace),
    coverage: createLocalizationHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationHubPolicies(policies),
    validation: validateLocalizationHubPolicies(policies),
    escalationDeck: createLocalizationHubEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationHubAnalyticsTimeline(),
      forecast: createLocalizationHubForecastEnvelope(),
      exceptions: createLocalizationHubExceptionLedger(),
      summary: summarizeLocalizationHubAnalytics()
    },
    operations: {
      board: createLocalizationHubOperationsBoard(),
      checklist: createLocalizationHubShiftChecklist(),
      incidents: createLocalizationHubIncidentDeck()
    },
    reporting: {
      cards: createLocalizationHubReportCards(),
      packets: createLocalizationHubReviewPackets(),
      summary: summarizeLocalizationHubReporting()
    },
    audit: {
      trail: createLocalizationHubAuditTrail(),
      manifest: createLocalizationHubEvidenceManifest(),
      attestation: createLocalizationHubReadinessAttestation()
    },
    playbooks: createLocalizationHubPlaybooks(),
    decisions: createLocalizationHubDecisionDeck(),
    escalationMoments: createLocalizationHubEscalationMoments()
  };
}

export function createLocalizationHubReadinessBoard(snapshot = buildLocalizationHubSnapshot()) {
  return [
    { id: 'localization-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationHubApiDocument(snapshot = buildLocalizationHubSnapshot()) {
  return {
    id: 'localization-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-hub/overview' },
      { method: 'GET', path: '/api/localization-hub/reporting' },
      { method: 'POST', path: '/api/localization-hub/validate' },
      { method: 'GET', path: '/api/localization-hub/audit' }
    ],
    readiness: createLocalizationHubReadinessBoard(snapshot)
  };
}

export function createLocalizationHubRouteSummary(snapshot = buildLocalizationHubSnapshot()) {
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

