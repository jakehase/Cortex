import { createActivationAtlasWorkspace, summarizeActivationAtlasWorkspace, createActivationAtlasNarratives, createActivationAtlasCoverageGrid } from './domain-activation-atlas.mjs';
import { createActivationAtlasPolicies, validateActivationAtlasPolicies, summarizeActivationAtlasPolicies, createActivationAtlasEscalationDeck } from './policies-activation-atlas.mjs';
import { createActivationAtlasAnalyticsTimeline, createActivationAtlasForecastEnvelope, createActivationAtlasExceptionLedger, summarizeActivationAtlasAnalytics } from './analytics-activation-atlas.mjs';
import { createActivationAtlasOperationsBoard, createActivationAtlasShiftChecklist, createActivationAtlasIncidentDeck } from './operations-activation-atlas.mjs';
import { createActivationAtlasReportCards, createActivationAtlasReviewPackets, summarizeActivationAtlasReporting } from './reporting-activation-atlas.mjs';
import { createActivationAtlasAuditTrail, createActivationAtlasEvidenceManifest, createActivationAtlasReadinessAttestation } from './audit-activation-atlas.mjs';
import { createActivationAtlasPlaybooks, createActivationAtlasDecisionDeck, createActivationAtlasEscalationMoments } from './playbooks-activation-atlas.mjs';

export function buildActivationAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationAtlasWorkspace(workspaceName);
  const policies = createActivationAtlasPolicies();
  return {
    workspace,
    summary: summarizeActivationAtlasWorkspace(workspace),
    narratives: createActivationAtlasNarratives(workspace),
    coverage: createActivationAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationAtlasPolicies(policies),
    validation: validateActivationAtlasPolicies(policies),
    escalationDeck: createActivationAtlasEscalationDeck(policies),
    analytics: {
      timeline: createActivationAtlasAnalyticsTimeline(),
      forecast: createActivationAtlasForecastEnvelope(),
      exceptions: createActivationAtlasExceptionLedger(),
      summary: summarizeActivationAtlasAnalytics()
    },
    operations: {
      board: createActivationAtlasOperationsBoard(),
      checklist: createActivationAtlasShiftChecklist(),
      incidents: createActivationAtlasIncidentDeck()
    },
    reporting: {
      cards: createActivationAtlasReportCards(),
      packets: createActivationAtlasReviewPackets(),
      summary: summarizeActivationAtlasReporting()
    },
    audit: {
      trail: createActivationAtlasAuditTrail(),
      manifest: createActivationAtlasEvidenceManifest(),
      attestation: createActivationAtlasReadinessAttestation()
    },
    playbooks: createActivationAtlasPlaybooks(),
    decisions: createActivationAtlasDecisionDeck(),
    escalationMoments: createActivationAtlasEscalationMoments()
  };
}

export function createActivationAtlasReadinessBoard(snapshot = buildActivationAtlasSnapshot()) {
  return [
    { id: 'activation-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationAtlasApiDocument(snapshot = buildActivationAtlasSnapshot()) {
  return {
    id: 'activation-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-atlas/overview' },
      { method: 'GET', path: '/api/activation-atlas/reporting' },
      { method: 'POST', path: '/api/activation-atlas/validate' },
      { method: 'GET', path: '/api/activation-atlas/audit' }
    ],
    readiness: createActivationAtlasReadinessBoard(snapshot)
  };
}

export function createActivationAtlasRouteSummary(snapshot = buildActivationAtlasSnapshot()) {
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

