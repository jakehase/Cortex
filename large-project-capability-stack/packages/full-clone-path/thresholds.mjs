import { CLAIM_LADDER } from '../certification/index.mjs';
import {
  SURFACE_FAMILY_CATALOG,
  TOP_TIER_BROWSER_JOURNEYS,
  ARTIFACT_CLASS_CATALOG,
  ENTERPRISE_FAMILY_IDS,
  ECOSYSTEM_FAMILY_IDS,
  SCALE_OPS_FAMILY_IDS
} from './catalogs.mjs';

export {
  SURFACE_FAMILY_CATALOG,
  TOP_TIER_BROWSER_JOURNEYS,
  ARTIFACT_CLASS_CATALOG,
  ENTERPRISE_FAMILY_IDS,
  ECOSYSTEM_FAMILY_IDS,
  SCALE_OPS_FAMILY_IDS
};

export const CLAIM_THRESHOLD_MODEL_VERSION = 2;

function baseClaim({ scores, metrics, qualitative, required, minimumCompleteCount, recommendedExpansion = [], targetMetrics, note }) {
  return {
    minimums: {
      scores,
      metrics,
      qualitative,
      surfaceFamilies: { required, minimumCompleteCount, recommendedExpansion }
    },
    operationalTarget: { metrics: targetMetrics, note }
  };
}

function metrics(values) {
  return {
    productFiles: 0,
    productLines: 0,
    testFiles: 0,
    testLines: 0,
    packageCount: 0,
    appCount: 0,
    moduleRoots: 0,
    routeFiles: 0,
    domainFiles: 0,
    surfaceFamiliesComplete: 0,
    parityChecks: 0,
    liveHttpChecks: 0,
    browserChecks: 0,
    realBrowserChecks: 0,
    browserJourneyFamilies: 0,
    integrationSurfaceFamilies: 0,
    enterpriseSurfaceFamilies: 0,
    artifactClasses: 0,
    evidenceArtifacts: 0,
    ...values
  };
}

function qualitative(values) {
  return {
    parityOk: false,
    repoTestsOk: false,
    targetTestsOk: false,
    supervisorOk: false,
    notifyOk: false,
    realBrowser: false,
    evidenceRealism: false,
    browserRealismAtScale: false,
    integrationRealism: false,
    enterpriseReadiness: false,
    scaleOpsRealism: false,
    ...values
  };
}

export function createClaimThresholdModel() {
  return {
    version: CLAIM_THRESHOLD_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    ladder: CLAIM_LADDER,
    baseline: {
      source: 'packages/certification + packages/architecture-enforcer + packages/full-clone-path',
      note: 'Refines coarse truth gating into explicit machine-readable upgrade thresholds, with top-tier structural metrics for browser realism, integrations, enterprise breadth, and artifact realism.'
    },
    surfaceFamilyCatalog: SURFACE_FAMILY_CATALOG,
    browserJourneyCatalog: TOP_TIER_BROWSER_JOURNEYS,
    artifactClassCatalog: ARTIFACT_CLASS_CATALOG,
    claimLevels: {
      prototype: baseClaim({
        scores: { repoShape: 0, codeVolume: 0, testBreadth: 0, architectureSplit: 0, evidenceDepth: 0, browserGrade: 0 },
        metrics: metrics({ productFiles: 1, productLines: 100, surfaceFamiliesComplete: 1, artifactClasses: 1, evidenceArtifacts: 1 }),
        qualitative: qualitative(),
        required: ['platform_foundation'],
        minimumCompleteCount: 1,
        targetMetrics: metrics({ productFiles: 3, productLines: 250, testFiles: 1, testLines: 40, surfaceFamiliesComplete: 1, artifactClasses: 2, evidenceArtifacts: 2 }),
        note: 'Enough shape to show a real product slice exists.'
      }),
      production_slice: baseClaim({
        scores: { repoShape: 1, codeVolume: 1, testBreadth: 1, architectureSplit: 2, evidenceDepth: 1, browserGrade: 0 },
        metrics: metrics({ productFiles: 5, productLines: 400, testFiles: 2, testLines: 100, packageCount: 1, appCount: 1, moduleRoots: 1, routeFiles: 2, domainFiles: 1, surfaceFamiliesComplete: 2, artifactClasses: 2, evidenceArtifacts: 2 }),
        qualitative: qualitative({ repoTestsOk: true }),
        required: ['platform_foundation', 'audience_crm'],
        minimumCompleteCount: 2,
        targetMetrics: metrics({ productFiles: 8, productLines: 800, testFiles: 3, testLines: 180, packageCount: 1, appCount: 1, moduleRoots: 1, routeFiles: 2, domainFiles: 1, surfaceFamiliesComplete: 3, artifactClasses: 3, evidenceArtifacts: 3 }),
        note: 'Enough depth to survive refactors without collapsing into a single-file demo.'
      }),
      scoped_parity: baseClaim({
        scores: { repoShape: 2, codeVolume: 2, testBreadth: 2, architectureSplit: 2, evidenceDepth: 2, browserGrade: 1 },
        metrics: metrics({ productFiles: 12, productLines: 1500, testFiles: 5, testLines: 400, packageCount: 2, appCount: 1, moduleRoots: 2, routeFiles: 5, domainFiles: 3, surfaceFamiliesComplete: 6, parityChecks: 3, liveHttpChecks: 3, enterpriseSurfaceFamilies: 1, artifactClasses: 4, evidenceArtifacts: 4 }),
        qualitative: qualitative({ parityOk: true, repoTestsOk: true, targetTestsOk: true, supervisorOk: true, notifyOk: true, evidenceRealism: true }),
        required: ['platform_foundation', 'audience_crm', 'campaign_authoring_delivery', 'automation_journeys', 'forms_landing_pages', 'reporting_analytics'],
        minimumCompleteCount: 6,
        targetMetrics: metrics({ productFiles: 18, productLines: 2500, testFiles: 7, testLines: 800, packageCount: 2, appCount: 1, moduleRoots: 2, routeFiles: 5, domainFiles: 3, surfaceFamiliesComplete: 7, parityChecks: 6, liveHttpChecks: 3, browserChecks: 2, artifactClasses: 5, evidenceArtifacts: 5 }),
        note: 'Credible parity inside a bounded scope, but still mechanically downgradeable for full-clone claims.'
      }),
      full_clone_credible: baseClaim({
        scores: { repoShape: 3, codeVolume: 3, testBreadth: 3, architectureSplit: 3, evidenceDepth: 3, browserGrade: 4 },
        metrics: metrics({ productFiles: 30, productLines: 12000, testFiles: 10, testLines: 1200, packageCount: 4, appCount: 1, moduleRoots: 4, routeFiles: 9, domainFiles: 5, surfaceFamiliesComplete: 9, parityChecks: 6, liveHttpChecks: 4, browserChecks: 4, realBrowserChecks: 4, browserJourneyFamilies: 3, integrationSurfaceFamilies: 1, enterpriseSurfaceFamilies: 1, artifactClasses: 6, evidenceArtifacts: 8 }),
        qualitative: qualitative({ parityOk: true, repoTestsOk: true, targetTestsOk: true, supervisorOk: true, notifyOk: true, realBrowser: true, evidenceRealism: true }),
        required: ['platform_foundation', 'audience_crm', 'campaign_authoring_delivery', 'automation_journeys', 'forms_landing_pages', 'reporting_analytics', 'admin_api_ops', 'content_asset_templates', 'integrations_marketplace'],
        minimumCompleteCount: 9,
        recommendedExpansion: ['commerce_revenue', 'collaboration_approval', 'deliverability_compliance'],
        targetMetrics: metrics({ productFiles: 36, productLines: 15000, testFiles: 12, testLines: 1600, packageCount: 5, appCount: 1, moduleRoots: 5, routeFiles: 12, domainFiles: 7, surfaceFamiliesComplete: 10, parityChecks: 12, liveHttpChecks: 6, browserChecks: 6, realBrowserChecks: 6, browserJourneyFamilies: 4, integrationSurfaceFamilies: 2, enterpriseSurfaceFamilies: 2, artifactClasses: 7, evidenceArtifacts: 10 }),
        note: 'Recommended operating buffer so the claim is resilient instead of barely passing the ladder.'
      }),
      large_product_replica: baseClaim({
        scores: { repoShape: 5, codeVolume: 5, testBreadth: 5, architectureSplit: 4, evidenceDepth: 4, browserGrade: 5 },
        metrics: metrics({ productFiles: 250, productLines: 750000, testFiles: 80, testLines: 120000, packageCount: 20, appCount: 2, moduleRoots: 20, routeFiles: 60, domainFiles: 40, surfaceFamiliesComplete: 12, parityChecks: 30, liveHttpChecks: 12, browserChecks: 20, realBrowserChecks: 20, browserJourneyFamilies: 4, integrationSurfaceFamilies: 2, enterpriseSurfaceFamilies: 2, artifactClasses: 7, evidenceArtifacts: 20 }),
        qualitative: qualitative({ parityOk: true, repoTestsOk: true, targetTestsOk: true, supervisorOk: true, notifyOk: true, realBrowser: true, evidenceRealism: true, browserRealismAtScale: true, integrationRealism: true, enterpriseReadiness: true, scaleOpsRealism: true }),
        required: SURFACE_FAMILY_CATALOG.map((family) => family.id),
        minimumCompleteCount: 12,
        targetMetrics: metrics({ productFiles: 350, productLines: 1000000, testFiles: 120, testLines: 180000, packageCount: 30, appCount: 3, moduleRoots: 30, routeFiles: 90, domainFiles: 60, surfaceFamiliesComplete: 12, parityChecks: 50, liveHttpChecks: 18, browserChecks: 30, realBrowserChecks: 30, browserJourneyFamilies: 6, integrationSurfaceFamilies: 3, enterpriseSurfaceFamilies: 3, artifactClasses: 8, evidenceArtifacts: 30 }),
        note: 'Mailchimp-scale replica floor. This is the first tier intended to represent a genuinely large-product replica rather than a mid-scale credible clone.'
      }),
      real_world_indistinguishable: baseClaim({
        scores: { repoShape: 5, codeVolume: 5, testBreadth: 5, architectureSplit: 4, evidenceDepth: 5, browserGrade: 5 },
        metrics: metrics({ productFiles: 500, productLines: 1500000, testFiles: 150, testLines: 240000, packageCount: 40, appCount: 4, moduleRoots: 40, routeFiles: 140, domainFiles: 90, surfaceFamiliesComplete: 12, parityChecks: 100, liveHttpChecks: 30, browserChecks: 60, realBrowserChecks: 60, browserJourneyFamilies: 8, integrationSurfaceFamilies: 3, enterpriseSurfaceFamilies: 3, artifactClasses: 9, evidenceArtifacts: 40 }),
        qualitative: qualitative({ parityOk: true, repoTestsOk: true, targetTestsOk: true, supervisorOk: true, notifyOk: true, realBrowser: true, evidenceRealism: true, browserRealismAtScale: true, integrationRealism: true, enterpriseReadiness: true, scaleOpsRealism: true }),
        required: SURFACE_FAMILY_CATALOG.map((family) => family.id),
        minimumCompleteCount: 12,
        targetMetrics: metrics({ productFiles: 650, productLines: 2000000, testFiles: 220, testLines: 320000, packageCount: 50, appCount: 5, moduleRoots: 50, routeFiles: 180, domainFiles: 120, surfaceFamiliesComplete: 12, parityChecks: 140, liveHttpChecks: 40, browserChecks: 90, realBrowserChecks: 90, browserJourneyFamilies: 8, integrationSurfaceFamilies: 3, enterpriseSurfaceFamilies: 3, artifactClasses: 9, evidenceArtifacts: 60 }),
        note: 'Extraordinary proof tier above large_product_replica. Requires browser proof across all major journey families, enterprise/admin/compliance breadth, ecosystem depth, scale/ops realism, and artifact realism strong enough that the product would be hard to mechanically distinguish from a mature real-world system.'
      })
    },
    topTierExpectations: {
      large_product_replica: {
        summary: 'Very large, broad product replica with real browser evidence and full surface-family coverage.',
        requiredJourneyFamilies: 4,
        requiredArtifactClasses: 7,
        requiredEnterpriseFamilies: 2,
        requiredIntegrationFamilies: 2
      },
      real_world_indistinguishable: {
        summary: 'Massive, deeply proven product whose evidence trail looks like a real operating system of teams, integrations, and browser-tested workflows.',
        requiredJourneyFamilies: 8,
        requiredArtifactClasses: 9,
        requiredEnterpriseFamilies: ENTERPRISE_FAMILY_IDS.length,
        requiredIntegrationFamilies: ECOSYSTEM_FAMILY_IDS.length,
        requiredScaleOpsFamilies: SCALE_OPS_FAMILY_IDS.length
      }
    }
  };
}
