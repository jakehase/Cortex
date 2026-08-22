import {
  assertAiosMailchimpManifestReady,
  buildAiosMailchimpManifest,
} from "./manifest-writer.mjs";

export const PACKAGE_SCAFFOLD_PROTOCOL = "aios.language.mailchimp-package-scaffold.v1";

function cleanText(value) {
  return String(value ?? "").trim();
}

function stableHash(value) {
  const source = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function diagnostic(severity, code, message, path = "$", nextAction = "") {
  return Object.freeze({ severity, code, message, path, ...(nextAction ? { nextAction } : {}) });
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function freezeList(values) {
  return Object.freeze((Array.isArray(values) ? values : [])
    .map(cleanText)
    .filter(Boolean));
}

function renderAdapterModule(manifestContract) {
  const mailchimp = manifestContract.manifest.mailchimp;
  const tenantBoundary = manifestContract.manifest.tenantBoundary;
  const body = {
    protocol: "aios.language.mailchimp-runtime-adapter.v1",
    provider: "mailchimp",
    sourceHash: manifestContract.manifest.sourceHash,
    statusChannel: mailchimp.syncChannel,
    correlationId: mailchimp.correlationId,
    requiredScopes: manifestContract.manifest.kernel.capabilities,
    tenantIsolationKey: tenantBoundary?.isolationKey,
    tenantState: tenantBoundary?.state,
    recoveryToken: manifestContract.manifest.recovery.resumeToken,
  };
  return `export const mailchimpAdapterContract = ${JSON.stringify(body, null, 2)};\n`;
}

function renderPackageIndex(manifestContract) {
  return [
    `export const packageName = ${JSON.stringify(manifestContract.packageName)};`,
    `export const manifestHash = ${JSON.stringify(manifestContract.manifestHash)};`,
    `export const sourceHash = ${JSON.stringify(manifestContract.manifest.sourceHash)};`,
    "export { mailchimpAdapterContract } from \"./runtime/mailchimp-adapter.mjs\";",
    "",
  ].join("\n");
}

function createOperationalHealth(manifestContract, readiness, options = {}) {
  const tenantBoundary = manifestContract.manifest.tenantBoundary;
  const failureCodes = freezeList([
    ...readiness.diagnostics.map((entry) => entry.code),
    ...manifestContract.diagnostics
      .filter((entry) => entry.severity === "error")
      .map((entry) => entry.code),
  ]);
  const degradedReasons = freezeList([
    ...(manifestContract.status.state === "previewable" ? ["manifest-preview-only"] : []),
    ...(tenantBoundary?.state === "advisory" ? ["tenant-boundary-advisory"] : []),
    ...(manifestContract.manifest.mailchimp.syncChannel ? [] : ["mailchimp-sync-channel-missing"]),
  ]);
  const state = failureCodes.length > 0
    ? "unhealthy"
    : degradedReasons.length > 0
      ? "degraded"
      : "healthy";
  const retryable = state !== "healthy" && manifestContract.status.state !== "provider-blocked";
  const requestedBackoff = Number(options.retryBackoffMs ?? options.backoffMs ?? 1000);
  const backoffMs = Number.isFinite(requestedBackoff) && requestedBackoff > 0
    ? Math.min(Math.floor(requestedBackoff), 30000)
    : 1000;

  return Object.freeze({
    protocol: "aios.language.mailchimp-package-health.v1",
    state,
    degradedMode: state === "degraded" ? "preview-only" : state === "unhealthy" ? "repair-only" : "none",
    packageName: manifestContract.packageName,
    sourceHash: manifestContract.manifest.sourceHash,
    manifestHash: manifestContract.manifestHash,
    failureCodes,
    degradedReasons,
    retry: Object.freeze({
      retryable,
      attempt: 0,
      maxAttempts: Math.max(1, Number(options.retryLimit ?? manifestContract.manifest.recovery.retryLimit ?? 3)),
      backoffMs,
      nextBackoffMs: retryable ? backoffMs : 0,
      nextAction: retryable ? "retry-mailchimp-package-scaffold" : manifestContract.status.nextAction,
    }),
    actions: Object.freeze([
      ...(failureCodes.length > 0
        ? [Object.freeze({
          id: "repair-manifest-before-scaffold",
          severity: "error",
          nextAction: readiness.nextAction,
        })]
        : []),
      ...(degradedReasons.length > 0
        ? [Object.freeze({
          id: "continue-in-degraded-preview",
          severity: "warn",
          nextAction: "preview-mailchimp-package-scaffold",
        })]
        : []),
      Object.freeze({
        id: "record-health-handoff",
        severity: "info",
        nextAction: "record-mailchimp-package-health",
      }),
    ]),
  });
}

function createProviderServiceHandoff(manifestContract, operationalHealth, options = {}) {
  const mailchimp = manifestContract.manifest.mailchimp;
  const capabilities = freezeList(manifestContract.manifest.kernel.capabilities);
  const requiredScopes = freezeList(["campaigns:read", "campaigns:write", "audiences:read"]);
  const acceptedScopes = freezeList(requiredScopes.filter((scope) => capabilities.includes(scope)));
  const missingScopes = freezeList(requiredScopes.filter((scope) => !capabilities.includes(scope)));
  const externalId = cleanText(mailchimp.campaignId || mailchimp.audienceId || mailchimp.correlationId);
  const requestedMode = cleanText(options.mode || (options.write === true ? "write" : "preview")) || "preview";
  const negotiationState = missingScopes.length === 0 && mailchimp.syncChannel
    ? "negotiated"
    : operationalHealth.state === "unhealthy"
      ? "blocked"
      : "needs-provider-settings";
  const handoffState = negotiationState === "negotiated"
    ? requestedMode === "write" ? "publishable" : "previewable"
    : negotiationState;
  const idempotencyKey = stableHash([
    "mailchimp-provider-service",
    manifestContract.packageName,
    manifestContract.manifestHash,
    mailchimp.syncChannel,
    externalId,
  ].join(":"));
  const restartToken = externalId
    ? stableHash(["mailchimp-restart", manifestContract.manifest.sourceHash, externalId].join(":"))
    : "";

  return Object.freeze({
    protocol: "aios.language.mailchimp-provider-service-handoff.v1",
    provider: "mailchimp",
    service: "campaign-sync",
    packageName: manifestContract.packageName,
    state: handoffState,
    negotiation: Object.freeze({
      state: negotiationState,
      requiredScopes,
      acceptedScopes,
      missingScopes,
      capabilityCoverage: requiredScopes.length === 0 ? 1 : acceptedScopes.length / requiredScopes.length,
      syncChannelReady: Boolean(mailchimp.syncChannel),
    }),
    syncMetadata: Object.freeze({
      syncChannel: cleanText(mailchimp.syncChannel),
      correlationId: cleanText(mailchimp.correlationId),
      audienceId: cleanText(mailchimp.audienceId),
      campaignId: cleanText(mailchimp.campaignId),
      externalId,
      sourceHash: manifestContract.manifest.sourceHash,
      manifestHash: manifestContract.manifestHash,
    }),
    externalHandoff: Object.freeze({
      state: handoffState,
      statusField: externalId ? (mailchimp.campaignId ? "campaignId" : "audienceId") : "correlationId",
      statusValue: externalId,
      idempotencyKey,
      restartToken,
      canResume: Boolean(restartToken) && negotiationState === "negotiated",
      nextAction: negotiationState === "negotiated"
        ? requestedMode === "write" ? "publish-mailchimp-provider-handoff" : "preview-mailchimp-provider-handoff"
        : missingScopes.length > 0
          ? "negotiate-mailchimp-provider-capabilities"
          : "configure-mailchimp-sync-channel",
    }),
    clientContract: Object.freeze({
      protocol: "aios.language.mailchimp-provider-client-contract.v1",
      requiredFields: Object.freeze([
        "provider",
        "service",
        "syncMetadata",
        "externalHandoff",
        "idempotencyKey",
        "restartToken",
      ]),
      acceptedWriteModes: Object.freeze(["preview", "write"]),
      writeMode: requestedMode === "write" ? "write" : "preview",
      restartSafe: Boolean(restartToken) && operationalHealth.state !== "unhealthy",
    }),
  });
}

function createAcceptancePacket(manifestContract, status, operationalHealth, providerServiceHandoff, options = {}) {
  const tenantBoundary = manifestContract.manifest.tenantBoundary;
  const safeBoundary = tenantBoundary?.safeBoundary ?? {};
  const requestedMode = cleanText(options.acceptanceMode ?? options.mode ?? (status.writeEnabled ? "write" : "preview")) || "preview";
  const clientId = cleanText(options.clientId ?? options.client ?? "route-client");
  const acceptanceMode = requestedMode === "write" || requestedMode === "accept" ? "write" : "preview";
  const providerReady = providerServiceHandoff.negotiation.state === "negotiated";
  const tenantReady = tenantBoundary?.state !== "blocked" && safeBoundary.canWritePackage !== false;
  const healthReady = operationalHealth.state !== "unhealthy";
  const previewReady = status.state === "preview-ready" || status.state === "write-plan-ready";
  const accepted = Boolean(options.accept === true || requestedMode === "accept")
    && providerReady
    && tenantReady
    && healthReady
    && previewReady;
  const blockers = freezeList([
    ...(previewReady ? [] : [`scaffold.${status.state}`]),
    ...(healthReady ? [] : operationalHealth.failureCodes.map((code) => `health.${code}`)),
    ...(providerReady ? [] : providerServiceHandoff.negotiation.missingScopes.map((scope) => `scope.${scope}`)),
    ...(providerServiceHandoff.syncMetadata.syncChannel ? [] : ["sync-channel-missing"]),
    ...(tenantReady ? [] : ["tenant-boundary-blocked"]),
    ...(providerServiceHandoff.clientContract.restartSafe ? [] : ["provider-restart-not-safe"]),
  ]);
  const warnings = freezeList([
    ...(operationalHealth.degradedReasons ?? []).map((reason) => `degraded.${reason}`),
    ...(tenantBoundary?.state === "advisory" ? ["tenant-boundary-advisory"] : []),
    ...(acceptanceMode === "write" && safeBoundary.canWritePackage !== true ? ["write-boundary-not-confirmed"] : []),
  ]);
  const readinessScoreParts = [
    previewReady,
    healthReady,
    providerReady,
    tenantReady,
    providerServiceHandoff.clientContract.restartSafe,
  ];
  const readinessScore = readinessScoreParts
    .filter(Boolean)
    .length / readinessScoreParts.length;
  const bodyFields = Object.freeze([
    "packageName",
    "sourceHash",
    "manifestHash",
    "providerServiceHandoff",
    "tenantBoundary",
    "operationalHealth",
    "acceptancePacket",
  ]);
  const packetId = stableHash([
    "mailchimp-package-acceptance",
    manifestContract.packageName,
    manifestContract.manifestHash,
    providerServiceHandoff.externalHandoff.idempotencyKey,
    tenantBoundary?.isolationKey,
    acceptanceMode,
    clientId,
  ].join(":"));
  const idempotencyKey = stableHash([
    packetId,
    providerServiceHandoff.externalHandoff.statusValue,
    providerServiceHandoff.externalHandoff.restartToken,
    accepted ? "accepted" : "preview",
  ].join(":"));
  const state = accepted
    ? "accepted"
    : blockers.length === 0
      ? "ready"
      : previewReady
        ? "needs-acceptance-repair"
        : "blocked";
  const nextAction = state === "accepted"
    ? "publish-mailchimp-package-acceptance"
    : state === "ready"
      ? "accept-mailchimp-package-preview"
      : blockers.includes("tenant-boundary-blocked")
        ? "repair-mailchimp-tenant-boundary"
        : blockers.includes("provider-restart-not-safe")
          ? "repair-mailchimp-provider-restart"
          : blockers.find((blocker) => blocker.startsWith("scope."))
            ? "negotiate-mailchimp-provider-capabilities"
            : status.nextAction;

  return Object.freeze({
    protocol: "aios.language.mailchimp-package-acceptance-packet.v1",
    packetId,
    packageName: manifestContract.packageName,
    state,
    accepted,
    previewReady,
    acceptanceMode,
    clientId,
    readiness: Object.freeze({
      ready: blockers.length === 0,
      score: readinessScore,
      providerReady,
      tenantReady,
      healthReady,
      restartSafe: providerServiceHandoff.clientContract.restartSafe,
      degradedMode: operationalHealth.degradedMode,
      blockers,
      warnings,
      summary: blockers.length === 0
        ? "Mailchimp package preview can be accepted by a route client."
        : "Mailchimp package preview needs repair before route-client acceptance.",
    }),
    request: Object.freeze({
      command: accepted
        ? "aios.mailchimp.packageAcceptance.publish"
        : "aios.mailchimp.packageAcceptance.acceptPreview",
      method: "POST",
      bodyFields,
      idempotencyKey,
      restartToken: providerServiceHandoff.externalHandoff.restartToken,
    }),
    validationSummary: Object.freeze({
      ok: blockers.length === 0,
      readyForAcceptance: blockers.length === 0,
      blocking: blockers,
      warnings,
      nextAction,
    }),
    handoff: Object.freeze({
      provider: providerServiceHandoff.provider,
      service: providerServiceHandoff.service,
      state: providerServiceHandoff.state,
      negotiationState: providerServiceHandoff.negotiation.state,
      syncMetadata: providerServiceHandoff.syncMetadata,
      externalHandoff: providerServiceHandoff.externalHandoff,
      clientContract: providerServiceHandoff.clientContract,
    }),
    routeClient: Object.freeze({
      state: accepted ? "accepted" : blockers.length === 0 ? "ready" : "blocked",
      requiredFields: bodyFields,
      acceptanceUrl: `/api/mailchimp/packages/${manifestContract.packageName}/acceptance`,
      statusUrl: `/api/mailchimp/packages/${manifestContract.packageName}/status`,
      nextAction,
    }),
    nextSteps: Object.freeze([
      ...blockers.map((blocker, index) => Object.freeze({
        ordinal: index + 1,
        id: `repair-${blocker.replace(/[^A-Za-z0-9]+/g, "-")}`,
        blocker,
        command: blocker.startsWith("scope.")
          ? "aios.mailchimp.negotiateCapabilities"
          : blocker === "sync-channel-missing"
            ? "aios.mailchimp.configureSyncChannel"
            : blocker === "tenant-boundary-blocked"
              ? "aios.mailchimp.repairTenantBoundary"
              : "aios.mailchimp.packageScaffold",
        nextAction: blocker.startsWith("scope.")
          ? "negotiate-mailchimp-provider-capabilities"
          : blocker === "tenant-boundary-blocked"
            ? "repair-mailchimp-tenant-boundary"
            : status.nextAction,
      })),
      ...(blockers.length === 0
        ? [Object.freeze({
          ordinal: 1,
          id: accepted ? "publish-package-acceptance" : "accept-package-preview",
          blocker: "",
          command: accepted
            ? "aios.mailchimp.packageAcceptance.publish"
            : "aios.mailchimp.packageAcceptance.acceptPreview",
          nextAction,
        })]
        : []),
    ]),
    nextAction,
  });
}

function createScaffoldFiles(manifestContract, operationalHealth, providerServiceHandoff, acceptancePacket) {
  const manifestText = `${manifestContract.serialized}\n`;
  const adapterText = renderAdapterModule(manifestContract);
  const indexText = renderPackageIndex(manifestContract);
  const recoveryText = `${stableJson(manifestContract.manifest.recovery)}\n`;
  const tenantBoundaryText = `${stableJson(manifestContract.manifest.tenantBoundary)}\n`;
  const healthText = `${stableJson(operationalHealth)}\n`;
  const providerContractText = `${stableJson(providerServiceHandoff)}\n`;
  const externalHandoffText = `${stableJson(providerServiceHandoff.externalHandoff)}\n`;
  const acceptancePacketText = `${stableJson(acceptancePacket)}\n`;
  const fileSpecs = [
    { path: "manifest.json", kind: "manifest", text: manifestText },
    { path: "index.mjs", kind: "module", text: indexText },
    { path: "runtime/mailchimp-adapter.mjs", kind: "adapter-module", text: adapterText },
    { path: "runtime/recovery-handoff.json", kind: "recovery", text: recoveryText },
    { path: "runtime/tenant-boundary.json", kind: "tenant-boundary", text: tenantBoundaryText },
    { path: "runtime/operational-health.json", kind: "operational-health", text: healthText },
    { path: "runtime/provider-service-contract.json", kind: "provider-service-contract", text: providerContractText },
    { path: "runtime/external-handoff.json", kind: "external-handoff", text: externalHandoffText },
    { path: "runtime/acceptance-packet.json", kind: "acceptance-packet", text: acceptancePacketText },
  ];

  return Object.freeze(fileSpecs.map((file) => Object.freeze({
    path: `packages/${manifestContract.packageName}/${file.path}`,
    relativePath: file.path,
    kind: file.kind,
    bytes: file.text.length,
    contentHash: stableHash(file.text),
    writeMode: "planned",
    content: file.text,
  })));
}

function createScaffoldStatus(manifestContract, files, readiness, operationalHealth, options = {}) {
  const requestedWrite = options.write === true || cleanText(options.mode) === "write";
  const duplicatePaths = files
    .map((file) => file.path)
    .filter((path, index, all) => all.indexOf(path) !== index);
  const healthBlocksWrite = operationalHealth.state === "unhealthy";
  const state = readiness.ok && duplicatePaths.length === 0 && !healthBlocksWrite
    ? requestedWrite ? "write-plan-ready" : "preview-ready"
    : healthBlocksWrite ? "health-blocked" : "repair-required";
  return Object.freeze({
    protocol: "aios.language.mailchimp-package-scaffold-status.v1",
    state,
    writeEnabled: requestedWrite,
    degradedMode: operationalHealth.degradedMode,
    plannedFileCount: files.length,
    duplicatePaths: Object.freeze([...new Set(duplicatePaths)].sort()),
    packageName: manifestContract.packageName,
    sourceHash: manifestContract.manifest.sourceHash,
    manifestHash: manifestContract.manifestHash,
    healthState: operationalHealth.state,
    retryable: operationalHealth.retry.retryable,
    nextBackoffMs: operationalHealth.retry.nextBackoffMs,
    nextAction: state === "write-plan-ready"
      ? "write-mailchimp-package-scaffold"
      : state === "preview-ready"
        ? "preview-mailchimp-package-scaffold"
        : state === "health-blocked"
          ? operationalHealth.actions[0]?.nextAction || operationalHealth.retry.nextAction
        : readiness.nextAction,
  });
}

function createExportHistorySnapshot(manifestContract, files, status, operationalHealth, options = {}) {
  const manifestHealth = manifestContract.manifest.operationalHealth;
  const requestedHistory = Array.isArray(options.history)
    ? options.history
    : Array.isArray(options.exportHistory)
      ? options.exportHistory
      : [];
  const currentHash = stableHash([
    manifestContract.manifestHash,
    status.state,
    operationalHealth.state,
    files.map((file) => `${file.relativePath}:${file.contentHash}`).join("|"),
  ].join(":"));
  const previous = requestedHistory
    .map((entry, index) => Object.freeze({
      ordinal: index + 1,
      snapshotId: cleanText(entry?.snapshotId) || stableHash(`${index}:${entry?.manifestHash ?? ""}:${entry?.state ?? ""}`),
      manifestHash: cleanText(entry?.manifestHash),
      state: cleanText(entry?.state) || "unknown",
      fileCount: Number.isFinite(Number(entry?.fileCount)) ? Number(entry.fileCount) : 0,
    }))
    .filter((entry) => entry.manifestHash || entry.fileCount > 0)
    .slice(-5);
  const counters = Object.freeze({
    plannedFiles: files.length,
    jsonFiles: files.filter((file) => file.languageId === "json" || file.relativePath.endsWith(".json")).length,
    moduleFiles: files.filter((file) => file.relativePath.endsWith(".mjs")).length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    duplicatePaths: status.duplicatePaths.length,
    healthFailures: operationalHealth.failureCodes.length,
    degradedReasons: operationalHealth.degradedReasons.length,
    manifestFailures: manifestHealth?.failureSignals?.length ?? 0,
    historyDepth: previous.length,
  });
  const timeline = Object.freeze([
    Object.freeze({
      ordinal: 1,
      event: "manifest-health-read",
      state: manifestHealth?.state ?? "unknown",
      hash: stableHash(stableJson(manifestHealth ?? {})),
      nextAction: manifestHealth?.retry?.nextAction ?? manifestContract.status.nextAction,
    }),
    Object.freeze({
      ordinal: 2,
      event: "scaffold-health-shaped",
      state: operationalHealth.state,
      hash: stableHash(stableJson(operationalHealth)),
      nextAction: operationalHealth.retry.nextAction,
    }),
    Object.freeze({
      ordinal: 3,
      event: "files-planned",
      state: status.state,
      hash: stableHash(files.map((file) => file.contentHash).join(":")),
      nextAction: status.nextAction,
    }),
    Object.freeze({
      ordinal: 4,
      event: "export-history-snapshotted",
      state: previous.length > 0 ? "history-linked" : "history-started",
      hash: currentHash,
      nextAction: status.writeEnabled ? "write-mailchimp-package-scaffold" : "preview-mailchimp-package-scaffold",
    }),
  ]);
  const ready = status.state === "write-plan-ready" || status.state === "preview-ready";
  const snapshot = Object.freeze({
    protocol: "aios.language.mailchimp-package-export-history.v1",
    snapshotId: currentHash,
    packageName: manifestContract.packageName,
    sourceHash: manifestContract.manifest.sourceHash,
    manifestHash: manifestContract.manifestHash,
    state: status.state,
    healthState: operationalHealth.state,
    degradedMode: operationalHealth.degradedMode,
    previous,
    counters,
    timeline,
  });
  const report = Object.freeze({
    protocol: "aios.language.mailchimp-package-export-report.v1",
    ready,
    snapshotId: snapshot.snapshotId,
    packageName: manifestContract.packageName,
    state: status.state,
    fileCount: counters.plannedFiles,
    totalBytes: counters.totalBytes,
    healthState: operationalHealth.state,
    manifestHealthState: manifestHealth?.state ?? "unknown",
    exportMode: status.writeEnabled ? "write" : "preview",
    nextAction: ready ? status.nextAction : operationalHealth.actions[0]?.nextAction || status.nextAction,
  });

  return Object.freeze({ snapshot, report });
}

export function buildAiosMailchimpPackageScaffold(sourceOrManifest = "", options = {}) {
  const manifestContract = sourceOrManifest?.protocol
    ? sourceOrManifest
    : buildAiosMailchimpManifest(sourceOrManifest, options);
  const readiness = assertAiosMailchimpManifestReady(manifestContract);
  const operationalHealth = createOperationalHealth(manifestContract, readiness, options);
  const providerServiceHandoff = createProviderServiceHandoff(manifestContract, operationalHealth, options);
  const initialStatus = createScaffoldStatus(manifestContract, [], readiness, operationalHealth, options);
  const acceptancePacket = createAcceptancePacket(
    manifestContract,
    initialStatus,
    operationalHealth,
    providerServiceHandoff,
    options,
  );
  const files = createScaffoldFiles(manifestContract, operationalHealth, providerServiceHandoff, acceptancePacket);
  const status = createScaffoldStatus(manifestContract, files, readiness, operationalHealth, options);
  const finalAcceptancePacket = createAcceptancePacket(
    manifestContract,
    status,
    operationalHealth,
    providerServiceHandoff,
    options,
  );
  const exportHistory = createExportHistorySnapshot(manifestContract, files, status, operationalHealth, options);
  const diagnostics = Object.freeze([
    ...manifestContract.diagnostics,
    ...readiness.diagnostics,
    ...(status.duplicatePaths.length > 0
      ? [diagnostic("error", "AIOS_SCAFFOLD_DUPLICATE_PATH", "Package scaffold generated duplicate output paths.", "$.files", "repair-package-scaffold-paths")]
      : []),
    ...(operationalHealth.state === "unhealthy"
      ? [diagnostic("error", "AIOS_SCAFFOLD_HEALTH_BLOCKED", "Package scaffold health is blocked by unresolved manifest or tenant errors.", "$.operationalHealth", status.nextAction)]
      : []),
  ]);

  return Object.freeze({
    protocol: PACKAGE_SCAFFOLD_PROTOCOL,
    command: "package-scaffold",
    packageName: manifestContract.packageName,
    sourceHash: manifestContract.manifest.sourceHash,
    manifestHash: manifestContract.manifestHash,
    files,
    status,
    operationalHealth,
    providerServiceHandoff,
    acceptancePacket: finalAcceptancePacket,
    exportHistory: exportHistory.snapshot,
    exportReport: exportHistory.report,
    diagnostics,
    statusHandoff: Object.freeze({
      ...manifestContract.statusHandoff,
      scaffoldState: status.state,
      packageHealthState: operationalHealth.state,
      degradedMode: operationalHealth.degradedMode,
      retryable: operationalHealth.retry.retryable,
      plannedFileCount: files.length,
      exportSnapshotId: exportHistory.snapshot.snapshotId,
      exportReady: exportHistory.report.ready,
      exportMode: exportHistory.report.exportMode,
      providerServiceState: providerServiceHandoff.state,
      providerNegotiationState: providerServiceHandoff.negotiation.state,
      providerHandoffIdempotencyKey: providerServiceHandoff.externalHandoff.idempotencyKey,
      providerRestartSafe: providerServiceHandoff.clientContract.restartSafe,
      acceptancePacketId: finalAcceptancePacket.packetId,
      acceptanceState: finalAcceptancePacket.state,
      acceptanceReady: finalAcceptancePacket.readiness.ready,
      acceptanceIdempotencyKey: finalAcceptancePacket.request.idempotencyKey,
      nextAction: status.nextAction,
    }),
    recoveryHandoff: Object.freeze({
      ...manifestContract.recoveryHandoff,
      scaffoldState: status.state,
      packageHealthState: operationalHealth.state,
      retryPlan: operationalHealth.retry,
      scaffoldFileHashes: Object.freeze(files.map((file) => `${file.relativePath}:${file.contentHash}`)),
      exportHistorySnapshotId: exportHistory.snapshot.snapshotId,
      exportTimeline: exportHistory.snapshot.timeline,
      exportReport: Object.freeze({
        ready: exportHistory.report.ready,
        state: exportHistory.report.state,
        nextAction: exportHistory.report.nextAction,
      }),
      providerServiceHandoff: Object.freeze({
        state: providerServiceHandoff.state,
        negotiationState: providerServiceHandoff.negotiation.state,
        syncMetadata: providerServiceHandoff.syncMetadata,
        externalHandoff: providerServiceHandoff.externalHandoff,
        clientContract: providerServiceHandoff.clientContract,
      }),
      acceptancePacket: Object.freeze({
        packetId: finalAcceptancePacket.packetId,
        state: finalAcceptancePacket.state,
        accepted: finalAcceptancePacket.accepted,
        readiness: finalAcceptancePacket.readiness,
        request: finalAcceptancePacket.request,
        nextSteps: finalAcceptancePacket.nextSteps,
        nextAction: finalAcceptancePacket.nextAction,
      }),
      nextAction: status.nextAction,
    }),
  });
}

export function assertAiosMailchimpPackageScaffoldReady(contract) {
  const diagnostics = [];
  if (contract?.protocol !== PACKAGE_SCAFFOLD_PROTOCOL) {
    diagnostics.push(diagnostic("error", "AIOS_SCAFFOLD_PROTOCOL_INVALID", "Package scaffold protocol is missing or unsupported."));
  }
  if ((contract?.files?.length ?? 0) < 9) {
    diagnostics.push(diagnostic("error", "AIOS_SCAFFOLD_FILES_REQUIRED", "Package scaffold must plan manifest, index, adapter, recovery, tenant boundary, health, provider contract, external handoff, and acceptance packet files.", "$.files"));
  }
  if (!contract?.status?.nextAction) {
    diagnostics.push(diagnostic("error", "AIOS_SCAFFOLD_NEXT_ACTION_REQUIRED", "Package scaffold must expose a deterministic next action.", "$.status.nextAction"));
  }
  if (!contract?.operationalHealth?.retry) {
    diagnostics.push(diagnostic("error", "AIOS_SCAFFOLD_HEALTH_REQUIRED", "Package scaffold must expose operational health and retry semantics.", "$.operationalHealth"));
  }
  if (!contract?.exportHistory?.snapshotId || !contract?.exportReport?.protocol) {
    diagnostics.push(diagnostic("error", "AIOS_SCAFFOLD_EXPORT_HISTORY_REQUIRED", "Package scaffold must expose export history snapshots and report state.", "$.exportHistory"));
  }
  if (!contract?.providerServiceHandoff?.externalHandoff?.idempotencyKey) {
    diagnostics.push(diagnostic("error", "AIOS_SCAFFOLD_PROVIDER_HANDOFF_REQUIRED", "Package scaffold must expose provider service external handoff idempotency.", "$.providerServiceHandoff"));
  }
  if (!contract?.acceptancePacket?.request?.idempotencyKey || !contract?.acceptancePacket?.validationSummary) {
    diagnostics.push(diagnostic("error", "AIOS_SCAFFOLD_ACCEPTANCE_PACKET_REQUIRED", "Package scaffold must expose idempotent preview acceptance and validation summary state.", "$.acceptancePacket"));
  }
  if (contract?.acceptancePacket?.readiness?.ready === false && contract?.status?.state === "write-plan-ready") {
    diagnostics.push(diagnostic("warn", "AIOS_SCAFFOLD_ACCEPTANCE_NOT_READY", "Package scaffold write plan is ready but route-client acceptance still has blockers.", "$.acceptancePacket.readiness", contract.acceptancePacket.nextAction));
  }
  if (contract?.exportReport?.ready === false && contract?.status?.state !== "health-blocked") {
    diagnostics.push(diagnostic("warn", "AIOS_SCAFFOLD_EXPORT_NOT_READY", "Package scaffold export report is not ready for the current state.", "$.exportReport", contract.exportReport.nextAction));
  }
  if ((contract?.diagnostics ?? []).some((entry) => entry.severity === "error")) {
    diagnostics.push(diagnostic("error", "AIOS_SCAFFOLD_HAS_ERRORS", "Package scaffold has blocking diagnostics.", "$.diagnostics"));
  }
  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
    nextAction: diagnostics[0]?.nextAction || diagnostics[0]?.code || contract?.status?.nextAction || "repair-mailchimp-package-scaffold",
  });
}
