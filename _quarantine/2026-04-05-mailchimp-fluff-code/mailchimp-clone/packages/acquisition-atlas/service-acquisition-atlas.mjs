import { createAcquisitionAtlasWorkspace, summarizeAcquisitionAtlasWorkspace, createAcquisitionAtlasNarratives, createAcquisitionAtlasCoverageGrid } from './domain-acquisition-atlas.mjs';
import { createAcquisitionAtlasPolicies, validateAcquisitionAtlasPolicies, summarizeAcquisitionAtlasPolicies, createAcquisitionAtlasEscalationDeck } from './policies-acquisition-atlas.mjs';
import { createAcquisitionAtlasAnalyticsTimeline, createAcquisitionAtlasForecastEnvelope, createAcquisitionAtlasExceptionLedger, summarizeAcquisitionAtlasAnalytics } from './analytics-acquisition-atlas.mjs';
import { createAcquisitionAtlasOperationsBoard, createAcquisitionAtlasShiftChecklist, createAcquisitionAtlasIncidentDeck } from './operations-acquisition-atlas.mjs';
import { createAcquisitionAtlasReportCards, createAcquisitionAtlasReviewPackets, summarizeAcquisitionAtlasReporting } from './reporting-acquisition-atlas.mjs';
import { createAcquisitionAtlasAuditTrail, createAcquisitionAtlasEvidenceManifest, createAcquisitionAtlasReadinessAttestation } from './audit-acquisition-atlas.mjs';
import { createAcquisitionAtlasPlaybooks, createAcquisitionAtlasDecisionDeck, createAcquisitionAtlasEscalationMoments } from './playbooks-acquisition-atlas.mjs';

export function buildAcquisitionAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionAtlasWorkspace(workspaceName);
  const policies = createAcquisitionAtlasPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionAtlasWorkspace(workspace),
    narratives: createAcquisitionAtlasNarratives(workspace),
    coverage: createAcquisitionAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionAtlasPolicies(policies),
    validation: validateAcquisitionAtlasPolicies(policies),
    escalationDeck: createAcquisitionAtlasEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionAtlasAnalyticsTimeline(),
      forecast: createAcquisitionAtlasForecastEnvelope(),
      exceptions: createAcquisitionAtlasExceptionLedger(),
      summary: summarizeAcquisitionAtlasAnalytics()
    },
    operations: {
      board: createAcquisitionAtlasOperationsBoard(),
      checklist: createAcquisitionAtlasShiftChecklist(),
      incidents: createAcquisitionAtlasIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionAtlasReportCards(),
      packets: createAcquisitionAtlasReviewPackets(),
      summary: summarizeAcquisitionAtlasReporting()
    },
    audit: {
      trail: createAcquisitionAtlasAuditTrail(),
      manifest: createAcquisitionAtlasEvidenceManifest(),
      attestation: createAcquisitionAtlasReadinessAttestation()
    },
    playbooks: createAcquisitionAtlasPlaybooks(),
    decisions: createAcquisitionAtlasDecisionDeck(),
    escalationMoments: createAcquisitionAtlasEscalationMoments()
  };
}

export function createAcquisitionAtlasReadinessBoard(snapshot = buildAcquisitionAtlasSnapshot()) {
  return [
    { id: 'acquisition-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionAtlasApiDocument(snapshot = buildAcquisitionAtlasSnapshot()) {
  return {
    id: 'acquisition-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-atlas/overview' },
      { method: 'GET', path: '/api/acquisition-atlas/reporting' },
      { method: 'POST', path: '/api/acquisition-atlas/validate' },
      { method: 'GET', path: '/api/acquisition-atlas/audit' }
    ],
    readiness: createAcquisitionAtlasReadinessBoard(snapshot)
  };
}

export function createAcquisitionAtlasRouteSummary(snapshot = buildAcquisitionAtlasSnapshot()) {
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

