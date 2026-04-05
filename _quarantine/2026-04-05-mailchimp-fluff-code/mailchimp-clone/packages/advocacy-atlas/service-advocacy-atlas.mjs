import { createAdvocacyAtlasWorkspace, summarizeAdvocacyAtlasWorkspace, createAdvocacyAtlasNarratives, createAdvocacyAtlasCoverageGrid } from './domain-advocacy-atlas.mjs';
import { createAdvocacyAtlasPolicies, validateAdvocacyAtlasPolicies, summarizeAdvocacyAtlasPolicies, createAdvocacyAtlasEscalationDeck } from './policies-advocacy-atlas.mjs';
import { createAdvocacyAtlasAnalyticsTimeline, createAdvocacyAtlasForecastEnvelope, createAdvocacyAtlasExceptionLedger, summarizeAdvocacyAtlasAnalytics } from './analytics-advocacy-atlas.mjs';
import { createAdvocacyAtlasOperationsBoard, createAdvocacyAtlasShiftChecklist, createAdvocacyAtlasIncidentDeck } from './operations-advocacy-atlas.mjs';
import { createAdvocacyAtlasReportCards, createAdvocacyAtlasReviewPackets, summarizeAdvocacyAtlasReporting } from './reporting-advocacy-atlas.mjs';
import { createAdvocacyAtlasAuditTrail, createAdvocacyAtlasEvidenceManifest, createAdvocacyAtlasReadinessAttestation } from './audit-advocacy-atlas.mjs';
import { createAdvocacyAtlasPlaybooks, createAdvocacyAtlasDecisionDeck, createAdvocacyAtlasEscalationMoments } from './playbooks-advocacy-atlas.mjs';

export function buildAdvocacyAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyAtlasWorkspace(workspaceName);
  const policies = createAdvocacyAtlasPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyAtlasWorkspace(workspace),
    narratives: createAdvocacyAtlasNarratives(workspace),
    coverage: createAdvocacyAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyAtlasPolicies(policies),
    validation: validateAdvocacyAtlasPolicies(policies),
    escalationDeck: createAdvocacyAtlasEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyAtlasAnalyticsTimeline(),
      forecast: createAdvocacyAtlasForecastEnvelope(),
      exceptions: createAdvocacyAtlasExceptionLedger(),
      summary: summarizeAdvocacyAtlasAnalytics()
    },
    operations: {
      board: createAdvocacyAtlasOperationsBoard(),
      checklist: createAdvocacyAtlasShiftChecklist(),
      incidents: createAdvocacyAtlasIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyAtlasReportCards(),
      packets: createAdvocacyAtlasReviewPackets(),
      summary: summarizeAdvocacyAtlasReporting()
    },
    audit: {
      trail: createAdvocacyAtlasAuditTrail(),
      manifest: createAdvocacyAtlasEvidenceManifest(),
      attestation: createAdvocacyAtlasReadinessAttestation()
    },
    playbooks: createAdvocacyAtlasPlaybooks(),
    decisions: createAdvocacyAtlasDecisionDeck(),
    escalationMoments: createAdvocacyAtlasEscalationMoments()
  };
}

export function createAdvocacyAtlasReadinessBoard(snapshot = buildAdvocacyAtlasSnapshot()) {
  return [
    { id: 'advocacy-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyAtlasApiDocument(snapshot = buildAdvocacyAtlasSnapshot()) {
  return {
    id: 'advocacy-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-atlas/overview' },
      { method: 'GET', path: '/api/advocacy-atlas/reporting' },
      { method: 'POST', path: '/api/advocacy-atlas/validate' },
      { method: 'GET', path: '/api/advocacy-atlas/audit' }
    ],
    readiness: createAdvocacyAtlasReadinessBoard(snapshot)
  };
}

export function createAdvocacyAtlasRouteSummary(snapshot = buildAdvocacyAtlasSnapshot()) {
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

