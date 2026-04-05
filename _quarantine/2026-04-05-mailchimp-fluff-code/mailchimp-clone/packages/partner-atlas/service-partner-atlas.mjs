import { createPartnerAtlasWorkspace, summarizePartnerAtlasWorkspace, createPartnerAtlasNarratives, createPartnerAtlasCoverageGrid } from './domain-partner-atlas.mjs';
import { createPartnerAtlasPolicies, validatePartnerAtlasPolicies, summarizePartnerAtlasPolicies, createPartnerAtlasEscalationDeck } from './policies-partner-atlas.mjs';
import { createPartnerAtlasAnalyticsTimeline, createPartnerAtlasForecastEnvelope, createPartnerAtlasExceptionLedger, summarizePartnerAtlasAnalytics } from './analytics-partner-atlas.mjs';
import { createPartnerAtlasOperationsBoard, createPartnerAtlasShiftChecklist, createPartnerAtlasIncidentDeck } from './operations-partner-atlas.mjs';
import { createPartnerAtlasReportCards, createPartnerAtlasReviewPackets, summarizePartnerAtlasReporting } from './reporting-partner-atlas.mjs';
import { createPartnerAtlasAuditTrail, createPartnerAtlasEvidenceManifest, createPartnerAtlasReadinessAttestation } from './audit-partner-atlas.mjs';
import { createPartnerAtlasPlaybooks, createPartnerAtlasDecisionDeck, createPartnerAtlasEscalationMoments } from './playbooks-partner-atlas.mjs';

export function buildPartnerAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createPartnerAtlasWorkspace(workspaceName);
  const policies = createPartnerAtlasPolicies();
  return {
    workspace,
    summary: summarizePartnerAtlasWorkspace(workspace),
    narratives: createPartnerAtlasNarratives(workspace),
    coverage: createPartnerAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizePartnerAtlasPolicies(policies),
    validation: validatePartnerAtlasPolicies(policies),
    escalationDeck: createPartnerAtlasEscalationDeck(policies),
    analytics: {
      timeline: createPartnerAtlasAnalyticsTimeline(),
      forecast: createPartnerAtlasForecastEnvelope(),
      exceptions: createPartnerAtlasExceptionLedger(),
      summary: summarizePartnerAtlasAnalytics()
    },
    operations: {
      board: createPartnerAtlasOperationsBoard(),
      checklist: createPartnerAtlasShiftChecklist(),
      incidents: createPartnerAtlasIncidentDeck()
    },
    reporting: {
      cards: createPartnerAtlasReportCards(),
      packets: createPartnerAtlasReviewPackets(),
      summary: summarizePartnerAtlasReporting()
    },
    audit: {
      trail: createPartnerAtlasAuditTrail(),
      manifest: createPartnerAtlasEvidenceManifest(),
      attestation: createPartnerAtlasReadinessAttestation()
    },
    playbooks: createPartnerAtlasPlaybooks(),
    decisions: createPartnerAtlasDecisionDeck(),
    escalationMoments: createPartnerAtlasEscalationMoments()
  };
}

export function createPartnerAtlasReadinessBoard(snapshot = buildPartnerAtlasSnapshot()) {
  return [
    { id: 'partner-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'partner-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'partner-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'partner-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createPartnerAtlasApiDocument(snapshot = buildPartnerAtlasSnapshot()) {
  return {
    id: 'partner-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/partner-atlas/overview' },
      { method: 'GET', path: '/api/partner-atlas/reporting' },
      { method: 'POST', path: '/api/partner-atlas/validate' },
      { method: 'GET', path: '/api/partner-atlas/audit' }
    ],
    readiness: createPartnerAtlasReadinessBoard(snapshot)
  };
}

export function createPartnerAtlasRouteSummary(snapshot = buildPartnerAtlasSnapshot()) {
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

