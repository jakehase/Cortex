import { createEcommerceDossierWorkspace, summarizeEcommerceDossierWorkspace, createEcommerceDossierNarratives, createEcommerceDossierCoverageGrid } from './domain-ecommerce-dossier.mjs';
import { createEcommerceDossierPolicies, validateEcommerceDossierPolicies, summarizeEcommerceDossierPolicies, createEcommerceDossierEscalationDeck } from './policies-ecommerce-dossier.mjs';
import { createEcommerceDossierAnalyticsTimeline, createEcommerceDossierForecastEnvelope, createEcommerceDossierExceptionLedger, summarizeEcommerceDossierAnalytics } from './analytics-ecommerce-dossier.mjs';
import { createEcommerceDossierOperationsBoard, createEcommerceDossierShiftChecklist, createEcommerceDossierIncidentDeck } from './operations-ecommerce-dossier.mjs';
import { createEcommerceDossierReportCards, createEcommerceDossierReviewPackets, summarizeEcommerceDossierReporting } from './reporting-ecommerce-dossier.mjs';
import { createEcommerceDossierAuditTrail, createEcommerceDossierEvidenceManifest, createEcommerceDossierReadinessAttestation } from './audit-ecommerce-dossier.mjs';
import { createEcommerceDossierPlaybooks, createEcommerceDossierDecisionDeck, createEcommerceDossierEscalationMoments } from './playbooks-ecommerce-dossier.mjs';

export function buildEcommerceDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceDossierWorkspace(workspaceName);
  const policies = createEcommerceDossierPolicies();
  return {
    workspace,
    summary: summarizeEcommerceDossierWorkspace(workspace),
    narratives: createEcommerceDossierNarratives(workspace),
    coverage: createEcommerceDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceDossierPolicies(policies),
    validation: validateEcommerceDossierPolicies(policies),
    escalationDeck: createEcommerceDossierEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceDossierAnalyticsTimeline(),
      forecast: createEcommerceDossierForecastEnvelope(),
      exceptions: createEcommerceDossierExceptionLedger(),
      summary: summarizeEcommerceDossierAnalytics()
    },
    operations: {
      board: createEcommerceDossierOperationsBoard(),
      checklist: createEcommerceDossierShiftChecklist(),
      incidents: createEcommerceDossierIncidentDeck()
    },
    reporting: {
      cards: createEcommerceDossierReportCards(),
      packets: createEcommerceDossierReviewPackets(),
      summary: summarizeEcommerceDossierReporting()
    },
    audit: {
      trail: createEcommerceDossierAuditTrail(),
      manifest: createEcommerceDossierEvidenceManifest(),
      attestation: createEcommerceDossierReadinessAttestation()
    },
    playbooks: createEcommerceDossierPlaybooks(),
    decisions: createEcommerceDossierDecisionDeck(),
    escalationMoments: createEcommerceDossierEscalationMoments()
  };
}

export function createEcommerceDossierReadinessBoard(snapshot = buildEcommerceDossierSnapshot()) {
  return [
    { id: 'ecommerce-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceDossierApiDocument(snapshot = buildEcommerceDossierSnapshot()) {
  return {
    id: 'ecommerce-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-dossier/overview' },
      { method: 'GET', path: '/api/ecommerce-dossier/reporting' },
      { method: 'POST', path: '/api/ecommerce-dossier/validate' },
      { method: 'GET', path: '/api/ecommerce-dossier/audit' }
    ],
    readiness: createEcommerceDossierReadinessBoard(snapshot)
  };
}

export function createEcommerceDossierRouteSummary(snapshot = buildEcommerceDossierSnapshot()) {
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

