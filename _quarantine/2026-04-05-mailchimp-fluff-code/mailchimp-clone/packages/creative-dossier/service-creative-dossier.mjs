import { createCreativeDossierWorkspace, summarizeCreativeDossierWorkspace, createCreativeDossierNarratives, createCreativeDossierCoverageGrid } from './domain-creative-dossier.mjs';
import { createCreativeDossierPolicies, validateCreativeDossierPolicies, summarizeCreativeDossierPolicies, createCreativeDossierEscalationDeck } from './policies-creative-dossier.mjs';
import { createCreativeDossierAnalyticsTimeline, createCreativeDossierForecastEnvelope, createCreativeDossierExceptionLedger, summarizeCreativeDossierAnalytics } from './analytics-creative-dossier.mjs';
import { createCreativeDossierOperationsBoard, createCreativeDossierShiftChecklist, createCreativeDossierIncidentDeck } from './operations-creative-dossier.mjs';
import { createCreativeDossierReportCards, createCreativeDossierReviewPackets, summarizeCreativeDossierReporting } from './reporting-creative-dossier.mjs';
import { createCreativeDossierAuditTrail, createCreativeDossierEvidenceManifest, createCreativeDossierReadinessAttestation } from './audit-creative-dossier.mjs';
import { createCreativeDossierPlaybooks, createCreativeDossierDecisionDeck, createCreativeDossierEscalationMoments } from './playbooks-creative-dossier.mjs';

export function buildCreativeDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeDossierWorkspace(workspaceName);
  const policies = createCreativeDossierPolicies();
  return {
    workspace,
    summary: summarizeCreativeDossierWorkspace(workspace),
    narratives: createCreativeDossierNarratives(workspace),
    coverage: createCreativeDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeDossierPolicies(policies),
    validation: validateCreativeDossierPolicies(policies),
    escalationDeck: createCreativeDossierEscalationDeck(policies),
    analytics: {
      timeline: createCreativeDossierAnalyticsTimeline(),
      forecast: createCreativeDossierForecastEnvelope(),
      exceptions: createCreativeDossierExceptionLedger(),
      summary: summarizeCreativeDossierAnalytics()
    },
    operations: {
      board: createCreativeDossierOperationsBoard(),
      checklist: createCreativeDossierShiftChecklist(),
      incidents: createCreativeDossierIncidentDeck()
    },
    reporting: {
      cards: createCreativeDossierReportCards(),
      packets: createCreativeDossierReviewPackets(),
      summary: summarizeCreativeDossierReporting()
    },
    audit: {
      trail: createCreativeDossierAuditTrail(),
      manifest: createCreativeDossierEvidenceManifest(),
      attestation: createCreativeDossierReadinessAttestation()
    },
    playbooks: createCreativeDossierPlaybooks(),
    decisions: createCreativeDossierDecisionDeck(),
    escalationMoments: createCreativeDossierEscalationMoments()
  };
}

export function createCreativeDossierReadinessBoard(snapshot = buildCreativeDossierSnapshot()) {
  return [
    { id: 'creative-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeDossierApiDocument(snapshot = buildCreativeDossierSnapshot()) {
  return {
    id: 'creative-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-dossier/overview' },
      { method: 'GET', path: '/api/creative-dossier/reporting' },
      { method: 'POST', path: '/api/creative-dossier/validate' },
      { method: 'GET', path: '/api/creative-dossier/audit' }
    ],
    readiness: createCreativeDossierReadinessBoard(snapshot)
  };
}

export function createCreativeDossierRouteSummary(snapshot = buildCreativeDossierSnapshot()) {
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

