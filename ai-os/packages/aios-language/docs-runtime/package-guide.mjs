import {
  compileClaimGuide,
  createProviderExternalState,
  negotiateProviderCapabilities,
} from "./claim-guide.mjs";

const PACKAGE_CONTRACT_VERSION = "package-guide.contract.v1";

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

const asObject = (value) => (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {});

const uniqueSorted = (values) => {
  return [...new Set(values.map(stableText).filter(Boolean))].sort((left, right) => left.localeCompare(right));
};

const diagnostic = (code, message, path, severity = "error") => ({ code, message, path, severity });

export const normalizePackageGuideSource = (source = {}) => {
  const packageSource = asObject(source.package ?? source.runtimePackage);
  const claimSource = {
    ...source,
    route: stableText(source.route) || "mailchimp-package-guide",
    provider: {
      product: "mailchimp",
      ...asObject(source.provider),
    },
  };
  const compiledClaimGuide = compileClaimGuide(claimSource);
  const packageName = stableText(packageSource.name ?? source.name) || "mailchimp-aios-provider-package";
  const requestedServices = uniqueSorted(asArray(packageSource.services ?? source.services));
  const providerServices = compiledClaimGuide.providerServiceContracts.filter((service) => {
    return requestedServices.length === 0 || requestedServices.includes(service.name) || requestedServices.includes(service.serviceId);
  });
  const handoff = asObject(packageSource.handoff);

  return {
    contractVersion: PACKAGE_CONTRACT_VERSION,
    id: stableText(packageSource.id) || stableId("package", [packageName, compiledClaimGuide.providerContract.id]),
    name: packageName,
    providerId: compiledClaimGuide.providerContract.id,
    claimGuide: compiledClaimGuide,
    providerServices,
    exports: uniqueSorted([
      ...asArray(packageSource.exports),
      ...providerServices.map((service) => `${compiledClaimGuide.providerContract.id}.${service.name}`),
    ]),
    sync: {
      manifestTopic: stableText(handoff.manifestTopic) || `${compiledClaimGuide.jobContract.route}.package.manifest`,
      statusTopic: stableText(handoff.statusTopic) || compiledClaimGuide.providerContract.handoff.statusTopic,
      stateTopic: stableText(handoff.stateTopic) || compiledClaimGuide.providerContract.handoff.stateTopic,
    },
  };
};

export const validatePackageGuideSource = (source = {}) => {
  const normalized = normalizePackageGuideSource(source);
  const diagnostics = [...normalized.claimGuide.diagnostics];

  if (!normalized.name) {
    diagnostics.push(diagnostic("package_guide.name.missing", "Package guide must declare a package name.", "package.name"));
  }

  if (normalized.providerServices.length === 0) {
    diagnostics.push(
      diagnostic(
        "package_guide.provider_services.empty",
        "Package guide must expose at least one Mailchimp provider service.",
        "package.services",
      ),
    );
  }

  normalized.providerServices.forEach((service, index) => {
    if (!service.sync?.topic) {
      diagnostics.push(diagnostic("package_guide.service.sync_topic.missing", "Packaged services must expose a sync topic.", `services[${index}].sync.topic`));
    }
  });

  return {
    ok: diagnostics.every((entry) => entry.severity !== "error"),
    normalized,
    diagnostics,
  };
};

export const compilePackageGuide = (source = {}) => {
  const validation = validatePackageGuideSource(source);
  const normalized = validation.normalized;
  const serviceExports = normalized.providerServices.map((service) => ({
    id: stableId("package_export", [normalized.id, service.id]),
    packageId: normalized.id,
    providerId: normalized.providerId,
    serviceId: service.serviceId,
    serviceName: service.name,
    exportName: `${normalized.providerId}.${service.name}`,
    capabilities: service.capabilities,
    effects: service.effects,
    sync: service.sync,
  }));
  const negotiation = negotiateProviderCapabilities(normalized.claimGuide);

  return {
    ok: validation.ok && negotiation.ok,
    diagnostics: [...validation.diagnostics, ...negotiation.diagnostics],
    contractVersion: normalized.contractVersion,
    packageContract: {
      id: normalized.id,
      name: normalized.name,
      providerId: normalized.providerId,
      manifestTopic: normalized.sync.manifestTopic,
      exports: normalized.exports,
      serviceExports: serviceExports.map((entry) => entry.id),
      jobId: normalized.claimGuide.jobContract.id,
    },
    serviceExports,
    providerContract: normalized.claimGuide.providerContract,
    negotiation,
    adapterHandoff: {
      adapterId: normalized.claimGuide.adapterHandoff.adapterId,
      providerId: normalized.providerId,
      topic: normalized.sync.manifestTopic,
      statusTopic: normalized.sync.statusTopic,
      stateTopic: normalized.sync.stateTopic,
      status: validation.ok ? "ready" : "blocked",
    },
  };
};

export const createPackageSyncEnvelope = (compiled, serviceName, checkpoint = "") => {
  const service = compiled.serviceExports.find((entry) => entry.serviceName === serviceName || entry.serviceId === serviceName);
  const diagnostics = service
    ? []
    : [diagnostic("package_guide.sync.service.unknown", `Unknown package service "${stableText(serviceName)}".`, "serviceName")];

  return {
    ok: diagnostics.length === 0,
    packageId: compiled.packageContract.id,
    providerId: compiled.packageContract.providerId,
    topic: compiled.adapterHandoff.stateTopic,
    exportId: service?.id ?? null,
    serviceName: (service?.serviceName ?? stableText(serviceName)) || null,
    state: createProviderExternalState(
      {
        providerContract: compiled.providerContract,
        providerServiceContracts: compiled.serviceExports.map((entry) => ({
          id: entry.id,
          serviceId: entry.serviceId,
          name: entry.serviceName,
          sync: entry.sync,
        })),
        jobContract: { id: compiled.packageContract.jobId },
      },
      { service: service?.serviceName ?? serviceName, status: "sync-ready", checkpoint },
    ),
    diagnostics,
  };
};

export const selfCheckPackageGuide = (source = {}) => {
  const compiled = compilePackageGuide(source);
  const ids = [compiled.packageContract.id, ...compiled.serviceExports.map((entry) => entry.id)];
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);

  return {
    ok: compiled.ok && duplicateIds.length === 0,
    duplicateIds: uniqueSorted(duplicateIds),
    contractCounts: {
      serviceExports: compiled.serviceExports.length,
      providerServices: compiled.providerContract ? compiled.serviceExports.length : 0,
    },
    diagnostics: [
      ...compiled.diagnostics,
      ...duplicateIds.map((id) => diagnostic("package_guide.contract.id.duplicate", `Duplicate package contract id "${id}".`, "contracts")),
    ],
  };
};

export default compilePackageGuide;
