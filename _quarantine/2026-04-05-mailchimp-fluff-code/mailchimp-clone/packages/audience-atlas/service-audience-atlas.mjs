import { createAudienceAtlasWorkspace, summarizeAudienceAtlasWorkspace, createAudienceAtlasNarratives, createAudienceAtlasCoverageGrid } from './domain-audience-atlas.mjs';
import { createAudienceAtlasPolicies, validateAudienceAtlasPolicies, summarizeAudienceAtlasPolicies, createAudienceAtlasEscalationDeck } from './policies-audience-atlas.mjs';
import { createAudienceAtlasAnalyticsTimeline, createAudienceAtlasForecastEnvelope, createAudienceAtlasExceptionLedger, summarizeAudienceAtlasAnalytics } from './analytics-audience-atlas.mjs';
import { createAudienceAtlasOperationsBoard, createAudienceAtlasShiftChecklist, createAudienceAtlasIncidentDeck } from './operations-audience-atlas.mjs';
import { createAudienceAtlasReportCards, createAudienceAtlasReviewPackets, summarizeAudienceAtlasReporting } from './reporting-audience-atlas.mjs';
import { createAudienceAtlasAuditTrail, createAudienceAtlasEvidenceManifest, createAudienceAtlasReadinessAttestation } from './audit-audience-atlas.mjs';
import { createAudienceAtlasPlaybooks, createAudienceAtlasDecisionDeck, createAudienceAtlasEscalationMoments } from './playbooks-audience-atlas.mjs';

export function buildAudienceAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceAtlasWorkspace(workspaceName);
  const policies = createAudienceAtlasPolicies();
  return {
    workspace,
    summary: summarizeAudienceAtlasWorkspace(workspace),
    narratives: createAudienceAtlasNarratives(workspace),
    coverage: createAudienceAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceAtlasPolicies(policies),
    validation: validateAudienceAtlasPolicies(policies),
    escalationDeck: createAudienceAtlasEscalationDeck(policies),
    analytics: {
      timeline: createAudienceAtlasAnalyticsTimeline(),
      forecast: createAudienceAtlasForecastEnvelope(),
      exceptions: createAudienceAtlasExceptionLedger(),
      summary: summarizeAudienceAtlasAnalytics()
    },
    operations: {
      board: createAudienceAtlasOperationsBoard(),
      checklist: createAudienceAtlasShiftChecklist(),
      incidents: createAudienceAtlasIncidentDeck()
    },
    reporting: {
      cards: createAudienceAtlasReportCards(),
      packets: createAudienceAtlasReviewPackets(),
      summary: summarizeAudienceAtlasReporting()
    },
    audit: {
      trail: createAudienceAtlasAuditTrail(),
      manifest: createAudienceAtlasEvidenceManifest(),
      attestation: createAudienceAtlasReadinessAttestation()
    },
    playbooks: createAudienceAtlasPlaybooks(),
    decisions: createAudienceAtlasDecisionDeck(),
    escalationMoments: createAudienceAtlasEscalationMoments()
  };
}

export function createAudienceAtlasReadinessBoard(snapshot = buildAudienceAtlasSnapshot()) {
  return [
    { id: 'audience-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceAtlasApiDocument(snapshot = buildAudienceAtlasSnapshot()) {
  return {
    id: 'audience-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-atlas/overview' },
      { method: 'GET', path: '/api/audience-atlas/reporting' },
      { method: 'POST', path: '/api/audience-atlas/validate' },
      { method: 'GET', path: '/api/audience-atlas/audit' }
    ],
    readiness: createAudienceAtlasReadinessBoard(snapshot)
  };
}

export function createAudienceAtlasRouteSummary(snapshot = buildAudienceAtlasSnapshot()) {
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

