import { compileClaimGuide, createProviderExternalState, negotiateProviderCapabilities } from "./claim-guide.mjs";
import { compileOperatorGuide } from "./operator-guide.mjs";
import { compilePackageGuide } from "./package-guide.mjs";

const EXAMPLES_CONTRACT_VERSION = "examples-guide.contract.v1";

const stableText = (value) => String(value ?? "").trim();

const stableId = (prefix, parts) => {
  const text = parts.map((part) => stableText(part).toLowerCase()).filter(Boolean).join(":");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36).padStart(7, "0")}`;
};

const asArray = (value) => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

const uniqueSorted = (values) => {
  return [...new Set(values.map(stableText).filter(Boolean))].sort((left, right) => left.localeCompare(right));
};

const diagnostic = (code, message, path, severity = "error") => ({ code, message, path, severity });

export const createMailchimpClaimGuideExampleSource = (overrides = {}) => {
  return {
    route: "mailchimp-claim-guide",
    title: "Mailchimp provider claim guide",
    intent: "Compile Mailchimp audience, campaign, template, and report operations into recoverable AI OS contracts.",
    provider: {
      id: "mailchimp",
      product: "mailchimp",
      displayName: "Mailchimp",
      services: [
        {
          name: "audiences",
          scopes: ["lists:read", "lists:write"],
          capabilities: ["mailchimp.audience.read", "mailchimp.audience.write"],
          effects: ["read", "write", "network"],
          sync: {
            mode: "bidirectional",
            cursor: { key: "audiences.updated_at", source: "mailchimp" },
          },
        },
        {
          name: "campaigns",
          scopes: ["campaigns:read", "campaigns:write"],
          capabilities: ["mailchimp.campaign.read", "mailchimp.campaign.write"],
          effects: ["read", "write", "network", "artifact"],
          sync: {
            mode: "pull",
            cursor: { key: "campaigns.updated_at", source: "mailchimp" },
          },
        },
        {
          name: "reports",
          scopes: ["reports:read"],
          capabilities: ["mailchimp.report.read"],
          effects: ["read", "network", "memory"],
          sync: {
            mode: "pull",
            cursor: { key: "reports.generated_at", source: "mailchimp" },
          },
        },
      ],
    },
    claims: [
      {
        text: "Audience member sync preserves Mailchimp list identity and consent metadata.",
        capabilities: ["mailchimp.audience.read", "mailchimp.audience.write"],
        providerServices: ["audiences"],
        effects: ["read", "write", "network", "memory"],
        memories: ["audience-sync-ledger"],
        evidence: ["audience-id", "member-email-hash", "consent-status"],
      },
      {
        text: "Campaign status handoff reports external Mailchimp delivery state before completion.",
        capabilities: ["mailchimp.campaign.read"],
        providerServices: ["campaigns"],
        effects: ["read", "network", "artifact"],
        memories: ["campaign-status-ledger"],
        evidence: ["campaign-id", "send-status", "updated-at"],
      },
      {
        text: "Report ingestion stores aggregate metrics with a provider cursor checkpoint.",
        capabilities: ["mailchimp.report.read"],
        providerServices: ["reports"],
        effects: ["read", "network", "memory"],
        memories: ["report-metrics-ledger"],
        evidence: ["report-id", "generated-at", "open-rate"],
      },
    ],
    ...overrides,
  };
};

export const compileExamplesGuide = (source = {}) => {
  const exampleSource = createMailchimpClaimGuideExampleSource(source);
  const claimGuide = compileClaimGuide(exampleSource);
  const packageGuide = compilePackageGuide({
    ...exampleSource,
    package: {
      name: "mailchimp-provider-primary-package",
      services: ["audiences", "campaigns", "reports"],
    },
  });
  const operatorGuide = compileOperatorGuide({
    ...exampleSource,
    operator: {
      actions: [
        { service: "audiences", type: "resync-service", evidence: ["audience-id"] },
        { service: "campaigns", type: "inspect-provider-status", evidence: ["campaign-id"] },
        { service: "reports", type: "replay-cursor", evidence: ["report-id"] },
      ],
    },
  });
  const negotiation = negotiateProviderCapabilities(claimGuide);
  const externalStates = claimGuide.providerServiceContracts.map((service) =>
    createProviderExternalState(claimGuide, {
      service: service.name,
      status: "example-ready",
      checkpoint: `example:${service.name}:checkpoint`,
      metadata: { example: "mailchimp-primary-provider-contract" },
    }),
  );
  const diagnostics = [
    ...claimGuide.diagnostics,
    ...packageGuide.diagnostics,
    ...operatorGuide.diagnostics,
    ...negotiation.diagnostics,
    ...externalStates.flatMap((state) => state.diagnostics),
  ];

  return {
    ok: [claimGuide, packageGuide, operatorGuide, negotiation, ...externalStates].every((entry) => entry.ok),
    diagnostics,
    contractVersion: EXAMPLES_CONTRACT_VERSION,
    exampleContract: {
      id: stableId("example", [claimGuide.jobContract.id, packageGuide.packageContract.id, operatorGuide.operatorContract.id]),
      providerId: claimGuide.providerContract.id,
      route: claimGuide.jobContract.route,
      claimGuideJob: claimGuide.jobContract.id,
      packageId: packageGuide.packageContract.id,
      operatorId: operatorGuide.operatorContract.id,
      externalStateTopics: uniqueSorted(externalStates.map((state) => state.topic)),
    },
    claimGuide,
    packageGuide,
    operatorGuide,
    negotiation,
    externalStates,
  };
};

export const listMailchimpExampleContracts = (source = {}) => {
  const compiled = compileExamplesGuide(source);
  return {
    ok: compiled.ok,
    providerId: compiled.exampleContract.providerId,
    contracts: [
      {
        kind: "claim-guide",
        id: compiled.claimGuide.jobContract.id,
        statusTopic: compiled.claimGuide.adapterHandoff.statusTopic,
        providerServices: compiled.claimGuide.providerServiceContracts.map((service) => service.name),
      },
      {
        kind: "package-guide",
        id: compiled.packageGuide.packageContract.id,
        statusTopic: compiled.packageGuide.adapterHandoff.statusTopic,
        exports: compiled.packageGuide.packageContract.exports,
      },
      {
        kind: "operator-guide",
        id: compiled.operatorGuide.operatorContract.id,
        statusTopic: compiled.operatorGuide.operatorContract.statusTopic,
        actions: compiled.operatorGuide.actionContracts.map((action) => action.type),
      },
    ],
    diagnostics: compiled.diagnostics,
  };
};

export const validateExamplesGuide = (source = {}) => {
  const compiled = compileExamplesGuide(source);
  const diagnostics = [...compiled.diagnostics];

  if (compiled.externalStates.length === 0) {
    diagnostics.push(diagnostic("examples_guide.external_states.empty", "Mailchimp examples must emit external provider state examples.", "externalStates"));
  }

  const serviceNames = uniqueSorted(compiled.claimGuide.providerServiceContracts.map((service) => service.name));
  const stateServices = uniqueSorted(compiled.externalStates.map((state) => state.serviceName));
  serviceNames
    .filter((serviceName) => !stateServices.includes(serviceName))
    .forEach((serviceName) => {
      diagnostics.push(
        diagnostic("examples_guide.external_state.service.missing", `Example state missing for service "${serviceName}".`, "externalStates"),
      );
    });

  return {
    ok: compiled.ok && diagnostics.every((entry) => entry.severity !== "error"),
    diagnostics,
    compiled,
  };
};

export const selfCheckExamplesGuide = (source = {}) => {
  const validation = validateExamplesGuide(source);
  const compiled = validation.compiled;
  const ids = [
    compiled.exampleContract.id,
    compiled.claimGuide.jobContract.id,
    compiled.packageGuide.packageContract.id,
    compiled.operatorGuide.operatorContract.id,
    ...compiled.externalStates.map((state) => `${state.providerId}:${state.serviceName}:${state.cursor.checkpoint}`),
  ];
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);

  return {
    ok: validation.ok && duplicateIds.length === 0,
    duplicateIds: uniqueSorted(duplicateIds),
    contractCounts: {
      examples: 1,
      services: compiled.claimGuide.providerServiceContracts.length,
      externalStates: compiled.externalStates.length,
      packageExports: compiled.packageGuide.serviceExports.length,
      operatorActions: compiled.operatorGuide.actionContracts.length,
    },
    diagnostics: [
      ...validation.diagnostics,
      ...duplicateIds.map((id) => diagnostic("examples_guide.contract.id.duplicate", `Duplicate example contract id "${id}".`, "contracts")),
    ],
  };
};

export default compileExamplesGuide;
