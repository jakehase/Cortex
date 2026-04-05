import { createExperimentationAtlasWorkspace, summarizeExperimentationAtlasWorkspace, createExperimentationAtlasNarratives, createExperimentationAtlasCoverageGrid } from './domain-experimentation-atlas.mjs';
import { createExperimentationAtlasPolicies, validateExperimentationAtlasPolicies, summarizeExperimentationAtlasPolicies, createExperimentationAtlasEscalationDeck } from './policies-experimentation-atlas.mjs';
import { createExperimentationAtlasAnalyticsTimeline, createExperimentationAtlasForecastEnvelope, createExperimentationAtlasExceptionLedger, summarizeExperimentationAtlasAnalytics } from './analytics-experimentation-atlas.mjs';
import { createExperimentationAtlasOperationsBoard, createExperimentationAtlasShiftChecklist, createExperimentationAtlasIncidentDeck } from './operations-experimentation-atlas.mjs';
import { createExperimentationAtlasReportCards, createExperimentationAtlasReviewPackets, summarizeExperimentationAtlasReporting } from './reporting-experimentation-atlas.mjs';
import { createExperimentationAtlasAuditTrail, createExperimentationAtlasEvidenceManifest, createExperimentationAtlasReadinessAttestation } from './audit-experimentation-atlas.mjs';
import { createExperimentationAtlasPlaybooks, createExperimentationAtlasDecisionDeck, createExperimentationAtlasEscalationMoments } from './playbooks-experimentation-atlas.mjs';

export function buildExperimentationAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationAtlasWorkspace(workspaceName);
  const policies = createExperimentationAtlasPolicies();
  return {
    workspace,
    summary: summarizeExperimentationAtlasWorkspace(workspace),
    narratives: createExperimentationAtlasNarratives(workspace),
    coverage: createExperimentationAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationAtlasPolicies(policies),
    validation: validateExperimentationAtlasPolicies(policies),
    escalationDeck: createExperimentationAtlasEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationAtlasAnalyticsTimeline(),
      forecast: createExperimentationAtlasForecastEnvelope(),
      exceptions: createExperimentationAtlasExceptionLedger(),
      summary: summarizeExperimentationAtlasAnalytics()
    },
    operations: {
      board: createExperimentationAtlasOperationsBoard(),
      checklist: createExperimentationAtlasShiftChecklist(),
      incidents: createExperimentationAtlasIncidentDeck()
    },
    reporting: {
      cards: createExperimentationAtlasReportCards(),
      packets: createExperimentationAtlasReviewPackets(),
      summary: summarizeExperimentationAtlasReporting()
    },
    audit: {
      trail: createExperimentationAtlasAuditTrail(),
      manifest: createExperimentationAtlasEvidenceManifest(),
      attestation: createExperimentationAtlasReadinessAttestation()
    },
    playbooks: createExperimentationAtlasPlaybooks(),
    decisions: createExperimentationAtlasDecisionDeck(),
    escalationMoments: createExperimentationAtlasEscalationMoments()
  };
}

export function createExperimentationAtlasReadinessBoard(snapshot = buildExperimentationAtlasSnapshot()) {
  return [
    { id: 'experimentation-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationAtlasApiDocument(snapshot = buildExperimentationAtlasSnapshot()) {
  return {
    id: 'experimentation-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-atlas/overview' },
      { method: 'GET', path: '/api/experimentation-atlas/reporting' },
      { method: 'POST', path: '/api/experimentation-atlas/validate' },
      { method: 'GET', path: '/api/experimentation-atlas/audit' }
    ],
    readiness: createExperimentationAtlasReadinessBoard(snapshot)
  };
}

export function createExperimentationAtlasRouteSummary(snapshot = buildExperimentationAtlasSnapshot()) {
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

