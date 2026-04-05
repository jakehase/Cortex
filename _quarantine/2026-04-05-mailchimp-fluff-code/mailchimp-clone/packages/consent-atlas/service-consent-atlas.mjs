import { createConsentAtlasWorkspace, summarizeConsentAtlasWorkspace, createConsentAtlasNarratives, createConsentAtlasCoverageGrid } from './domain-consent-atlas.mjs';
import { createConsentAtlasPolicies, validateConsentAtlasPolicies, summarizeConsentAtlasPolicies, createConsentAtlasEscalationDeck } from './policies-consent-atlas.mjs';
import { createConsentAtlasAnalyticsTimeline, createConsentAtlasForecastEnvelope, createConsentAtlasExceptionLedger, summarizeConsentAtlasAnalytics } from './analytics-consent-atlas.mjs';
import { createConsentAtlasOperationsBoard, createConsentAtlasShiftChecklist, createConsentAtlasIncidentDeck } from './operations-consent-atlas.mjs';
import { createConsentAtlasReportCards, createConsentAtlasReviewPackets, summarizeConsentAtlasReporting } from './reporting-consent-atlas.mjs';
import { createConsentAtlasAuditTrail, createConsentAtlasEvidenceManifest, createConsentAtlasReadinessAttestation } from './audit-consent-atlas.mjs';
import { createConsentAtlasPlaybooks, createConsentAtlasDecisionDeck, createConsentAtlasEscalationMoments } from './playbooks-consent-atlas.mjs';

export function buildConsentAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentAtlasWorkspace(workspaceName);
  const policies = createConsentAtlasPolicies();
  return {
    workspace,
    summary: summarizeConsentAtlasWorkspace(workspace),
    narratives: createConsentAtlasNarratives(workspace),
    coverage: createConsentAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentAtlasPolicies(policies),
    validation: validateConsentAtlasPolicies(policies),
    escalationDeck: createConsentAtlasEscalationDeck(policies),
    analytics: {
      timeline: createConsentAtlasAnalyticsTimeline(),
      forecast: createConsentAtlasForecastEnvelope(),
      exceptions: createConsentAtlasExceptionLedger(),
      summary: summarizeConsentAtlasAnalytics()
    },
    operations: {
      board: createConsentAtlasOperationsBoard(),
      checklist: createConsentAtlasShiftChecklist(),
      incidents: createConsentAtlasIncidentDeck()
    },
    reporting: {
      cards: createConsentAtlasReportCards(),
      packets: createConsentAtlasReviewPackets(),
      summary: summarizeConsentAtlasReporting()
    },
    audit: {
      trail: createConsentAtlasAuditTrail(),
      manifest: createConsentAtlasEvidenceManifest(),
      attestation: createConsentAtlasReadinessAttestation()
    },
    playbooks: createConsentAtlasPlaybooks(),
    decisions: createConsentAtlasDecisionDeck(),
    escalationMoments: createConsentAtlasEscalationMoments()
  };
}

export function createConsentAtlasReadinessBoard(snapshot = buildConsentAtlasSnapshot()) {
  return [
    { id: 'consent-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentAtlasApiDocument(snapshot = buildConsentAtlasSnapshot()) {
  return {
    id: 'consent-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-atlas/overview' },
      { method: 'GET', path: '/api/consent-atlas/reporting' },
      { method: 'POST', path: '/api/consent-atlas/validate' },
      { method: 'GET', path: '/api/consent-atlas/audit' }
    ],
    readiness: createConsentAtlasReadinessBoard(snapshot)
  };
}

export function createConsentAtlasRouteSummary(snapshot = buildConsentAtlasSnapshot()) {
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

