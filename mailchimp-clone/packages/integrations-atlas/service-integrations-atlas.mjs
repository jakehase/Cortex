import { createIntegrationsAtlasWorkspace, summarizeIntegrationsAtlasWorkspace, createIntegrationsAtlasNarratives, createIntegrationsAtlasCoverageGrid } from './domain-integrations-atlas.mjs';
import { createIntegrationsAtlasPolicies, validateIntegrationsAtlasPolicies, summarizeIntegrationsAtlasPolicies, createIntegrationsAtlasEscalationDeck } from './policies-integrations-atlas.mjs';
import { createIntegrationsAtlasAnalyticsTimeline, createIntegrationsAtlasForecastEnvelope, createIntegrationsAtlasExceptionLedger, summarizeIntegrationsAtlasAnalytics } from './analytics-integrations-atlas.mjs';
import { createIntegrationsAtlasOperationsBoard, createIntegrationsAtlasShiftChecklist, createIntegrationsAtlasIncidentDeck } from './operations-integrations-atlas.mjs';
import { createIntegrationsAtlasReportCards, createIntegrationsAtlasReviewPackets, summarizeIntegrationsAtlasReporting } from './reporting-integrations-atlas.mjs';
import { createIntegrationsAtlasAuditTrail, createIntegrationsAtlasEvidenceManifest, createIntegrationsAtlasReadinessAttestation } from './audit-integrations-atlas.mjs';
import { createIntegrationsAtlasPlaybooks, createIntegrationsAtlasDecisionDeck, createIntegrationsAtlasEscalationMoments } from './playbooks-integrations-atlas.mjs';

export function buildIntegrationsAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsAtlasWorkspace(workspaceName);
  const policies = createIntegrationsAtlasPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsAtlasWorkspace(workspace),
    narratives: createIntegrationsAtlasNarratives(workspace),
    coverage: createIntegrationsAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsAtlasPolicies(policies),
    validation: validateIntegrationsAtlasPolicies(policies),
    escalationDeck: createIntegrationsAtlasEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsAtlasAnalyticsTimeline(),
      forecast: createIntegrationsAtlasForecastEnvelope(),
      exceptions: createIntegrationsAtlasExceptionLedger(),
      summary: summarizeIntegrationsAtlasAnalytics()
    },
    operations: {
      board: createIntegrationsAtlasOperationsBoard(),
      checklist: createIntegrationsAtlasShiftChecklist(),
      incidents: createIntegrationsAtlasIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsAtlasReportCards(),
      packets: createIntegrationsAtlasReviewPackets(),
      summary: summarizeIntegrationsAtlasReporting()
    },
    audit: {
      trail: createIntegrationsAtlasAuditTrail(),
      manifest: createIntegrationsAtlasEvidenceManifest(),
      attestation: createIntegrationsAtlasReadinessAttestation()
    },
    playbooks: createIntegrationsAtlasPlaybooks(),
    decisions: createIntegrationsAtlasDecisionDeck(),
    escalationMoments: createIntegrationsAtlasEscalationMoments()
  };
}

export function createIntegrationsAtlasReadinessBoard(snapshot = buildIntegrationsAtlasSnapshot()) {
  return [
    { id: 'integrations-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsAtlasApiDocument(snapshot = buildIntegrationsAtlasSnapshot()) {
  return {
    id: 'integrations-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-atlas/overview' },
      { method: 'GET', path: '/api/integrations-atlas/reporting' },
      { method: 'POST', path: '/api/integrations-atlas/validate' },
      { method: 'GET', path: '/api/integrations-atlas/audit' }
    ],
    readiness: createIntegrationsAtlasReadinessBoard(snapshot)
  };
}

export function createIntegrationsAtlasRouteSummary(snapshot = buildIntegrationsAtlasSnapshot()) {
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

