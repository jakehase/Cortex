import { createLocalizationExchangeWorkspace, summarizeLocalizationExchangeWorkspace, createLocalizationExchangeNarratives, createLocalizationExchangeCoverageGrid } from './domain-localization-exchange.mjs';
import { createLocalizationExchangePolicies, validateLocalizationExchangePolicies, summarizeLocalizationExchangePolicies, createLocalizationExchangeEscalationDeck } from './policies-localization-exchange.mjs';
import { createLocalizationExchangeAnalyticsTimeline, createLocalizationExchangeForecastEnvelope, createLocalizationExchangeExceptionLedger, summarizeLocalizationExchangeAnalytics } from './analytics-localization-exchange.mjs';
import { createLocalizationExchangeOperationsBoard, createLocalizationExchangeShiftChecklist, createLocalizationExchangeIncidentDeck } from './operations-localization-exchange.mjs';
import { createLocalizationExchangeReportCards, createLocalizationExchangeReviewPackets, summarizeLocalizationExchangeReporting } from './reporting-localization-exchange.mjs';
import { createLocalizationExchangeAuditTrail, createLocalizationExchangeEvidenceManifest, createLocalizationExchangeReadinessAttestation } from './audit-localization-exchange.mjs';
import { createLocalizationExchangePlaybooks, createLocalizationExchangeDecisionDeck, createLocalizationExchangeEscalationMoments } from './playbooks-localization-exchange.mjs';

export function buildLocalizationExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationExchangeWorkspace(workspaceName);
  const policies = createLocalizationExchangePolicies();
  return {
    workspace,
    summary: summarizeLocalizationExchangeWorkspace(workspace),
    narratives: createLocalizationExchangeNarratives(workspace),
    coverage: createLocalizationExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationExchangePolicies(policies),
    validation: validateLocalizationExchangePolicies(policies),
    escalationDeck: createLocalizationExchangeEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationExchangeAnalyticsTimeline(),
      forecast: createLocalizationExchangeForecastEnvelope(),
      exceptions: createLocalizationExchangeExceptionLedger(),
      summary: summarizeLocalizationExchangeAnalytics()
    },
    operations: {
      board: createLocalizationExchangeOperationsBoard(),
      checklist: createLocalizationExchangeShiftChecklist(),
      incidents: createLocalizationExchangeIncidentDeck()
    },
    reporting: {
      cards: createLocalizationExchangeReportCards(),
      packets: createLocalizationExchangeReviewPackets(),
      summary: summarizeLocalizationExchangeReporting()
    },
    audit: {
      trail: createLocalizationExchangeAuditTrail(),
      manifest: createLocalizationExchangeEvidenceManifest(),
      attestation: createLocalizationExchangeReadinessAttestation()
    },
    playbooks: createLocalizationExchangePlaybooks(),
    decisions: createLocalizationExchangeDecisionDeck(),
    escalationMoments: createLocalizationExchangeEscalationMoments()
  };
}

export function createLocalizationExchangeReadinessBoard(snapshot = buildLocalizationExchangeSnapshot()) {
  return [
    { id: 'localization-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationExchangeApiDocument(snapshot = buildLocalizationExchangeSnapshot()) {
  return {
    id: 'localization-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-exchange/overview' },
      { method: 'GET', path: '/api/localization-exchange/reporting' },
      { method: 'POST', path: '/api/localization-exchange/validate' },
      { method: 'GET', path: '/api/localization-exchange/audit' }
    ],
    readiness: createLocalizationExchangeReadinessBoard(snapshot)
  };
}

export function createLocalizationExchangeRouteSummary(snapshot = buildLocalizationExchangeSnapshot()) {
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

