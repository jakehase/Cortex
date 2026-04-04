import { createDeliverabilityAtlasWorkspace, summarizeDeliverabilityAtlasWorkspace, createDeliverabilityAtlasNarratives, createDeliverabilityAtlasCoverageGrid } from './domain-deliverability-atlas.mjs';
import { createDeliverabilityAtlasPolicies, validateDeliverabilityAtlasPolicies, summarizeDeliverabilityAtlasPolicies, createDeliverabilityAtlasEscalationDeck } from './policies-deliverability-atlas.mjs';
import { createDeliverabilityAtlasAnalyticsTimeline, createDeliverabilityAtlasForecastEnvelope, createDeliverabilityAtlasExceptionLedger, summarizeDeliverabilityAtlasAnalytics } from './analytics-deliverability-atlas.mjs';
import { createDeliverabilityAtlasOperationsBoard, createDeliverabilityAtlasShiftChecklist, createDeliverabilityAtlasIncidentDeck } from './operations-deliverability-atlas.mjs';
import { createDeliverabilityAtlasReportCards, createDeliverabilityAtlasReviewPackets, summarizeDeliverabilityAtlasReporting } from './reporting-deliverability-atlas.mjs';
import { createDeliverabilityAtlasAuditTrail, createDeliverabilityAtlasEvidenceManifest, createDeliverabilityAtlasReadinessAttestation } from './audit-deliverability-atlas.mjs';
import { createDeliverabilityAtlasPlaybooks, createDeliverabilityAtlasDecisionDeck, createDeliverabilityAtlasEscalationMoments } from './playbooks-deliverability-atlas.mjs';

export function buildDeliverabilityAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityAtlasWorkspace(workspaceName);
  const policies = createDeliverabilityAtlasPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityAtlasWorkspace(workspace),
    narratives: createDeliverabilityAtlasNarratives(workspace),
    coverage: createDeliverabilityAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityAtlasPolicies(policies),
    validation: validateDeliverabilityAtlasPolicies(policies),
    escalationDeck: createDeliverabilityAtlasEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityAtlasAnalyticsTimeline(),
      forecast: createDeliverabilityAtlasForecastEnvelope(),
      exceptions: createDeliverabilityAtlasExceptionLedger(),
      summary: summarizeDeliverabilityAtlasAnalytics()
    },
    operations: {
      board: createDeliverabilityAtlasOperationsBoard(),
      checklist: createDeliverabilityAtlasShiftChecklist(),
      incidents: createDeliverabilityAtlasIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityAtlasReportCards(),
      packets: createDeliverabilityAtlasReviewPackets(),
      summary: summarizeDeliverabilityAtlasReporting()
    },
    audit: {
      trail: createDeliverabilityAtlasAuditTrail(),
      manifest: createDeliverabilityAtlasEvidenceManifest(),
      attestation: createDeliverabilityAtlasReadinessAttestation()
    },
    playbooks: createDeliverabilityAtlasPlaybooks(),
    decisions: createDeliverabilityAtlasDecisionDeck(),
    escalationMoments: createDeliverabilityAtlasEscalationMoments()
  };
}

export function createDeliverabilityAtlasReadinessBoard(snapshot = buildDeliverabilityAtlasSnapshot()) {
  return [
    { id: 'deliverability-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityAtlasApiDocument(snapshot = buildDeliverabilityAtlasSnapshot()) {
  return {
    id: 'deliverability-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-atlas/overview' },
      { method: 'GET', path: '/api/deliverability-atlas/reporting' },
      { method: 'POST', path: '/api/deliverability-atlas/validate' },
      { method: 'GET', path: '/api/deliverability-atlas/audit' }
    ],
    readiness: createDeliverabilityAtlasReadinessBoard(snapshot)
  };
}

export function createDeliverabilityAtlasRouteSummary(snapshot = buildDeliverabilityAtlasSnapshot()) {
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

