export const APP_SHELLS = [
  {
    "id": "growth-grid",
    "title": "Growth Grid",
    "groupIds": [
      "growth"
    ]
  },
  {
    "id": "revenue-command",
    "title": "Revenue Command",
    "groupIds": [
      "revenue"
    ]
  },
  {
    "id": "trust-vault",
    "title": "Trust Vault",
    "groupIds": [
      "trust"
    ]
  },
  {
    "id": "intelligence-works",
    "title": "Intelligence Works",
    "groupIds": [
      "intelligence"
    ]
  },
  {
    "id": "lifecycle-network",
    "title": "Lifecycle Network",
    "groupIds": [
      "lifecycle"
    ]
  }
];
export const GROUPS = [
  {
    "id": "growth",
    "title": "Growth, acquisition, and channel planning",
    "description": "Portfolio planning surfaces that help teams model demand creation, audience readiness, channel pacing, and conversion posture.",
    "domains": [
      "acquisition",
      "activation",
      "advocacy",
      "audience",
      "campaign",
      "channel",
      "content"
    ],
    "metrics": [
      "coverage",
      "velocity",
      "pipeline",
      "adoption",
      "conversion",
      "efficiency"
    ],
    "lanes": [
      "plan",
      "prioritize",
      "launch",
      "stabilize",
      "review",
      "scale"
    ],
    "controls": [
      "budget-fence",
      "targeting-review",
      "handoff-check",
      "qa-ready",
      "launch-approval",
      "post-launch-retro"
    ],
    "evidenceTypes": [
      "brief",
      "launch-log",
      "coverage-map",
      "experiment-report",
      "handoff-packet",
      "weekly-summary"
    ],
    "signals": [
      "reach",
      "response",
      "conversion",
      "lift",
      "handoff",
      "risk"
    ],
    "persona": "growth lead",
    "chunkRefs": [
      "growthChunk01",
      "growthChunk02",
      "growthChunk03",
      "growthChunk04",
      "growthChunk05",
      "growthChunk06"
    ]
  },
  {
    "id": "revenue",
    "title": "Revenue, billing, and commerce operations",
    "description": "Revenue-centric operations that connect launches to billing posture, commerce readiness, and commercial recovery motions.",
    "domains": [
      "analytics",
      "benchmark",
      "billing",
      "commerce",
      "ecommerce",
      "insights",
      "revenue"
    ],
    "metrics": [
      "gmv",
      "margin",
      "revenue",
      "recovery",
      "benchmark",
      "forecast"
    ],
    "lanes": [
      "baseline",
      "model",
      "reconcile",
      "approve",
      "share",
      "improve"
    ],
    "controls": [
      "finance-approval",
      "forecast-gap",
      "margin-guardrail",
      "merchant-review",
      "closeout-check",
      "variance-brief"
    ],
    "evidenceTypes": [
      "forecast-pack",
      "variance-deck",
      "billing-log",
      "merchant-summary",
      "revenue-snapshot",
      "close-report"
    ],
    "signals": [
      "gmv",
      "margin",
      "variance",
      "pacing",
      "refund",
      "collection"
    ],
    "persona": "revenue operations manager",
    "chunkRefs": [
      "revenueChunk01",
      "revenueChunk02",
      "revenueChunk03",
      "revenueChunk04",
      "revenueChunk05"
    ]
  },
  {
    "id": "trust",
    "title": "Trust, compliance, and partner governance",
    "description": "Governance surfaces that keep regional requirements, audit evidence, partner operations, and trust posture visible.",
    "domains": [
      "compliance",
      "consent",
      "localization",
      "partner",
      "preference",
      "release",
      "trust"
    ],
    "metrics": [
      "coverage",
      "exceptions",
      "sla",
      "proof",
      "regionality",
      "resolution"
    ],
    "lanes": [
      "detect",
      "triage",
      "remediate",
      "verify",
      "attest",
      "archive"
    ],
    "controls": [
      "evidence-lock",
      "regional-review",
      "policy-gate",
      "remediation-sla",
      "partner-attest",
      "release-hold"
    ],
    "evidenceTypes": [
      "audit-log",
      "attestation",
      "proof-chain",
      "policy-pack",
      "regional-report",
      "exception-summary"
    ],
    "signals": [
      "risk",
      "proof",
      "region",
      "exception",
      "attestation",
      "hold"
    ],
    "persona": "trust program owner",
    "chunkRefs": [
      "trustChunk01",
      "trustChunk02",
      "trustChunk03"
    ]
  },
  {
    "id": "intelligence",
    "title": "Data, experimentation, and segmentation intelligence",
    "description": "Analytical workspaces that connect data readiness, experimentation posture, segmentation depth, and attribution signals.",
    "domains": [
      "attribution",
      "data",
      "experimentation",
      "integrations",
      "reporting",
      "segmentation",
      "workspace"
    ],
    "metrics": [
      "freshness",
      "coverage",
      "confidence",
      "throughput",
      "lineage",
      "lift"
    ],
    "lanes": [
      "collect",
      "score",
      "verify",
      "activate",
      "compare",
      "publish"
    ],
    "controls": [
      "lineage-proof",
      "quality-threshold",
      "segment-review",
      "integration-watch",
      "publish-approval",
      "lift-audit"
    ],
    "evidenceTypes": [
      "data-contract",
      "segment-card",
      "experiment-summary",
      "lineage-map",
      "publication-brief",
      "insight-review"
    ],
    "signals": [
      "freshness",
      "lift",
      "match-rate",
      "coverage",
      "confidence",
      "latency"
    ],
    "persona": "analytics program lead",
    "chunkRefs": [
      "intelligenceChunk01",
      "intelligenceChunk02",
      "intelligenceChunk03",
      "intelligenceChunk04"
    ]
  },
  {
    "id": "lifecycle",
    "title": "Lifecycle, customer success, and messaging durability",
    "description": "Customer lifecycle surfaces spanning automation, retention, support, subscriptions, surveys, and deliverability operations.",
    "domains": [
      "automation",
      "collaboration",
      "creative",
      "customer",
      "deliverability",
      "lifecycle",
      "loyalty",
      "retention",
      "subscription",
      "support",
      "surveys",
      "transactional"
    ],
    "metrics": [
      "health",
      "retention",
      "response",
      "satisfaction",
      "deliverability",
      "durability"
    ],
    "lanes": [
      "observe",
      "coordinate",
      "assist",
      "resolve",
      "measure",
      "expand"
    ],
    "controls": [
      "response-sla",
      "journey-check",
      "approval-ring",
      "delivery-guard",
      "satisfaction-review",
      "recovery-kit"
    ],
    "evidenceTypes": [
      "journey-log",
      "service-brief",
      "response-matrix",
      "delivery-summary",
      "retention-pack",
      "experience-scorecard"
    ],
    "signals": [
      "health",
      "sentiment",
      "recovery",
      "sla",
      "delivery",
      "retention"
    ],
    "persona": "lifecycle operations lead",
    "chunkRefs": [
      "lifecycleChunk01",
      "lifecycleChunk02",
      "lifecycleChunk03",
      "lifecycleChunk04",
      "lifecycleChunk05",
      "lifecycleChunk06"
    ]
  }
];

