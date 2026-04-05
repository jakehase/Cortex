import { createLocalizationAtlasWorkspace, summarizeLocalizationAtlasWorkspace, createLocalizationAtlasNarratives, createLocalizationAtlasCoverageGrid } from './domain-localization-atlas.mjs';
import { createLocalizationAtlasPolicies, validateLocalizationAtlasPolicies, summarizeLocalizationAtlasPolicies, createLocalizationAtlasEscalationDeck } from './policies-localization-atlas.mjs';
import { createLocalizationAtlasAnalyticsTimeline, createLocalizationAtlasForecastEnvelope, createLocalizationAtlasExceptionLedger, summarizeLocalizationAtlasAnalytics } from './analytics-localization-atlas.mjs';
import { createLocalizationAtlasOperationsBoard, createLocalizationAtlasShiftChecklist, createLocalizationAtlasIncidentDeck } from './operations-localization-atlas.mjs';
import { createLocalizationAtlasReportCards, createLocalizationAtlasReviewPackets, summarizeLocalizationAtlasReporting } from './reporting-localization-atlas.mjs';
import { createLocalizationAtlasAuditTrail, createLocalizationAtlasEvidenceManifest, createLocalizationAtlasReadinessAttestation } from './audit-localization-atlas.mjs';
import { createLocalizationAtlasPlaybooks, createLocalizationAtlasDecisionDeck, createLocalizationAtlasEscalationMoments } from './playbooks-localization-atlas.mjs';

export function buildLocalizationAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationAtlasWorkspace(workspaceName);
  const policies = createLocalizationAtlasPolicies();
  return {
    workspace,
    summary: summarizeLocalizationAtlasWorkspace(workspace),
    narratives: createLocalizationAtlasNarratives(workspace),
    coverage: createLocalizationAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationAtlasPolicies(policies),
    validation: validateLocalizationAtlasPolicies(policies),
    escalationDeck: createLocalizationAtlasEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationAtlasAnalyticsTimeline(),
      forecast: createLocalizationAtlasForecastEnvelope(),
      exceptions: createLocalizationAtlasExceptionLedger(),
      summary: summarizeLocalizationAtlasAnalytics()
    },
    operations: {
      board: createLocalizationAtlasOperationsBoard(),
      checklist: createLocalizationAtlasShiftChecklist(),
      incidents: createLocalizationAtlasIncidentDeck()
    },
    reporting: {
      cards: createLocalizationAtlasReportCards(),
      packets: createLocalizationAtlasReviewPackets(),
      summary: summarizeLocalizationAtlasReporting()
    },
    audit: {
      trail: createLocalizationAtlasAuditTrail(),
      manifest: createLocalizationAtlasEvidenceManifest(),
      attestation: createLocalizationAtlasReadinessAttestation()
    },
    playbooks: createLocalizationAtlasPlaybooks(),
    decisions: createLocalizationAtlasDecisionDeck(),
    escalationMoments: createLocalizationAtlasEscalationMoments()
  };
}

export function createLocalizationAtlasReadinessBoard(snapshot = buildLocalizationAtlasSnapshot()) {
  return [
    { id: 'localization-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationAtlasApiDocument(snapshot = buildLocalizationAtlasSnapshot()) {
  return {
    id: 'localization-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-atlas/overview' },
      { method: 'GET', path: '/api/localization-atlas/reporting' },
      { method: 'POST', path: '/api/localization-atlas/validate' },
      { method: 'GET', path: '/api/localization-atlas/audit' }
    ],
    readiness: createLocalizationAtlasReadinessBoard(snapshot)
  };
}

export function createLocalizationAtlasRouteSummary(snapshot = buildLocalizationAtlasSnapshot()) {
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

