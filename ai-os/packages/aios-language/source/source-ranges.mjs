import { createCatalogDiagnostic } from "./diagnostic-catalog.mjs";
import { createMailchimpTenantSourceAnchorCorrelations } from "./ast-node-kinds.mjs";

export const AIOS_SOURCE_RANGE_PROVIDER_CAPABILITIES = Object.freeze({
  previewAddress: providerCapability({
    id: "previewAddress",
    required: true,
    handoff: "source-preview",
  }),
  highlight: providerCapability({
    id: "highlight",
    required: true,
    handoff: "editor-highlight",
  }),
  syncLedger: providerCapability({
    id: "syncLedger",
    required: false,
    handoff: "source-sync-ledger",
  }),
  externalUri: providerCapability({
    id: "externalUri",
    required: false,
    handoff: "external-source-uri",
  }),
});

export function normalizeSourceRange(range = {}, fallbackFileName = "inline.aios") {
  const fileName = String(range.fileName ?? fallbackFileName);
  const start = normalizePosition(range.start, 1, 1);
  const end = normalizePosition(range.end, start.line, start.column);
  const ordered = comparePositions(start, end) <= 0;
  const normalizedStart = ordered ? start : end;
  const normalizedEnd = ordered ? end : start;

  return Object.freeze({
    fileName,
    start: normalizedStart,
    end: normalizedEnd,
    status: ordered ? "ready" : "recovered",
    recovery: ordered ? null : "swapped-range-endpoints",
  });
}

export function createRangeStatus(range = {}, options = {}) {
  const normalized = normalizeSourceRange(range, options.fileName ?? "inline.aios");
  const singleLine = normalized.start.line === normalized.end.line;
  const empty = comparePositions(normalized.start, normalized.end) === 0;
  const invalidOffset = [normalized.start.offset, normalized.end.offset]
    .some((offset) => offset !== undefined && (!Number.isFinite(offset) || offset < 0));
  const diagnostics = invalidOffset
    ? [createCatalogDiagnostic("AIOS_SOURCE_RANGE", {
        range: normalized,
        message: "Source range offsets must be finite positive values.",
      })]
    : [];

  return Object.freeze({
    ok: diagnostics.length === 0,
    range: normalized,
    compact: compactSourceRange(normalized),
    shape: empty ? "point" : singleLine ? "span" : "block",
    status: diagnostics.length ? "blocked" : normalized.status,
    diagnostics: Object.freeze(diagnostics),
    handoff: Object.freeze({
      previewAddress: compactSourceRange(normalized),
      canHighlight: diagnostics.length === 0,
      recovery: normalized.recovery,
    }),
  });
}

export function compareSourceRanges(left = {}, right = {}) {
  const leftRange = normalizeSourceRange(left);
  const rightRange = normalizeSourceRange(right);
  return comparePositions(leftRange.start, rightRange.start)
    || comparePositions(leftRange.end, rightRange.end)
    || leftRange.fileName.localeCompare(rightRange.fileName);
}

export function sourceRangeContains(parent = {}, child = {}) {
  const parentRange = normalizeSourceRange(parent);
  const childRange = normalizeSourceRange(child, parentRange.fileName);

  return parentRange.fileName === childRange.fileName
    && comparePositions(parentRange.start, childRange.start) <= 0
    && comparePositions(parentRange.end, childRange.end) >= 0;
}

export function mergeSourceRanges(ranges = [], options = {}) {
  const normalized = ranges
    .filter(Boolean)
    .map((range) => normalizeSourceRange(range, options.fileName ?? "inline.aios"))
    .sort(compareSourceRanges);

  if (normalized.length === 0) {
    return normalizeSourceRange({ fileName: options.fileName ?? "inline.aios" });
  }

  const first = normalized[0];
  let start = first.start;
  let end = first.end;
  let fileName = first.fileName;
  let crossFile = false;

  for (const range of normalized.slice(1)) {
    if (range.fileName !== fileName) crossFile = true;
    if (comparePositions(range.start, start) < 0) start = range.start;
    if (comparePositions(range.end, end) > 0) end = range.end;
  }

  return Object.freeze({
    fileName,
    start,
    end,
    status: crossFile ? "recovered" : "ready",
    recovery: crossFile ? "merged-cross-file-ranges-into-first-file" : null,
  });
}

export function createNodeRangeIndex(nodes = [], options = {}) {
  const entries = [];
  const diagnostics = [];

  for (const node of nodes) {
    const status = createRangeStatus(node.range ?? {
      fileName: options.fileName,
      start: offsetPosition(node.start),
      end: offsetPosition(node.end ?? node.start),
    }, options);
    entries.push(Object.freeze({
      type: node.type ?? "Unknown",
      name: node.name ?? node.expression ?? node.strategy ?? null,
      range: status.range,
      compact: status.compact,
      shape: status.shape,
      handoff: status.handoff,
    }));
    diagnostics.push(...status.diagnostics);
  }

  return Object.freeze({
    ok: diagnostics.length === 0,
    entries: Object.freeze(entries.sort((left, right) => compareSourceRanges(left.range, right.range))),
    diagnostics: Object.freeze(diagnostics),
  });
}

export function createSourceRangeProviderContract(nodes = [], options = {}) {
  const index = createNodeRangeIndex(nodes, options);
  const requestedCapabilities = normalizeCapabilityList(options.capabilities);
  const capabilities = negotiateSourceRangeCapabilities(requestedCapabilities, {
    hasExternalBaseUri: Boolean(options.externalBaseUri),
    canHighlight: index.ok,
  });
  const syncMetadata = createSourceRangeSyncMetadata(index.entries, {
    fileName: options.fileName ?? "inline.aios",
    providerId: options.providerId ?? "aios-source-range-provider",
    revision: options.revision ?? null,
  });
  const blockedCapabilities = capabilities.filter((capability) => capability.status === "blocked");
  const diagnostics = [
    ...index.diagnostics,
    ...blockedCapabilities.map((capability) => createCatalogDiagnostic("AIOS_SOURCE_RANGE", {
      message: `Source range provider capability "${capability.id}" is required but unavailable.`,
      hint: `Enable ${capability.id} before external source handoff.`,
    })),
  ];

  return Object.freeze({
    ok: diagnostics.length === 0,
    status: diagnostics.length ? "blocked" : capabilities.some((capability) => capability.status === "degraded") ? "review" : "ready",
    providerId: syncMetadata.providerId,
    fileName: syncMetadata.fileName,
    capabilities: Object.freeze(capabilities),
    index,
    syncMetadata,
    externalHandoff: createExternalSourceRangeHandoff(index.entries, capabilities, {
      externalBaseUri: options.externalBaseUri,
      syncMetadata,
    }),
    diagnostics: Object.freeze(diagnostics),
  });
}

export function createSourceRangePersistenceSnapshot(nodes = [], options = {}) {
  const providerContract = createSourceRangeProviderContract(nodes, options);
  const previousAnchors = normalizePreviousSourceAnchors(options.previousAnchors);
  const acceptedAnchors = new Set((Array.isArray(options.acceptedAnchorIds) ? options.acceptedAnchorIds : [])
    .map((id) => String(id).trim())
    .filter(Boolean));
  const anchors = providerContract.index.entries.map((entry, index) => {
    const stableId = createStableSourceAnchorId(entry, index);
    const previous = previousAnchors.get(stableId) ?? null;
    const accepted = acceptedAnchors.has(stableId);
    const changed = previous
      ? previous.compact !== entry.compact || previous.shape !== entry.shape
      : false;
    return Object.freeze({
      id: stableId,
      type: entry.type,
      name: entry.name,
      compact: entry.compact,
      shape: entry.shape,
      status: providerContract.ok ? changed ? "changed" : "ready" : "blocked",
      previousCompact: previous?.compact ?? null,
      accepted,
      restartSafe: providerContract.ok && (accepted || options.requireAnchorAcceptance === false),
      idempotencyKey: `${providerContract.fileName}:${stableId}:${entry.compact}`,
      nextAction: providerContract.ok
        ? accepted || options.requireAnchorAcceptance === false
          ? "retain-source-range-anchor"
          : "accept-source-range-anchor"
        : "repair-source-range-index",
    });
  });
  const blockedAnchors = anchors.filter((anchor) => anchor.status === "blocked");
  const pendingAnchors = anchors.filter((anchor) => !anchor.accepted && options.requireAnchorAcceptance !== false);
  const changedAnchors = anchors.filter((anchor) => anchor.status === "changed");
  const status = providerContract.status === "blocked" || blockedAnchors.length
    ? "blocked"
    : pendingAnchors.length
      ? "pending"
      : changedAnchors.length
        ? "review"
        : "ready";

  return Object.freeze({
    ok: status === "ready" || status === "review",
    status,
    version: "source-range-persistence.v1",
    fileName: providerContract.fileName,
    providerId: providerContract.providerId,
    syncKey: providerContract.syncMetadata.syncKey,
    restartSafe: status !== "blocked",
    anchors: Object.freeze(anchors),
    recovery: Object.freeze({
      blockedAnchorIds: Object.freeze(blockedAnchors.map((anchor) => anchor.id)),
      pendingAnchorIds: Object.freeze(pendingAnchors.map((anchor) => anchor.id)),
      changedAnchorIds: Object.freeze(changedAnchors.map((anchor) => anchor.id)),
      nextAction: blockedAnchors[0]?.nextAction
        ?? pendingAnchors[0]?.nextAction
        ?? changedAnchors[0]?.nextAction
        ?? providerContract.externalHandoff.nextAction,
    }),
    commands: Object.freeze(createSourceRangeRestoreCommands(anchors, providerContract, options)),
    providerContract,
  });
}

export function createSourceRangeExportManifest(nodes = [], options = {}) {
  const providerContract = options.providerContract ?? createSourceRangeProviderContract(nodes, options);
  const persistence = options.persistence ?? createSourceRangePersistenceSnapshot(nodes, {
    ...options,
    providerContract,
  });
  const capabilityCounters = {};
  const anchorCounters = {};
  const handoffCounters = {};

  for (const capability of providerContract.capabilities ?? []) {
    incrementRangeCounter(capabilityCounters, capability.status);
    incrementRangeCounter(handoffCounters, capability.handoff);
  }
  for (const anchor of persistence.anchors ?? []) {
    incrementRangeCounter(anchorCounters, anchor.status);
  }
  for (const range of providerContract.externalHandoff?.ranges ?? []) {
    incrementRangeCounter(handoffCounters, range.externalUri ? "external-uri" : "local-preview");
  }

  const blockedCapabilities = (providerContract.capabilities ?? [])
    .filter((capability) => capability.status === "blocked");
  const degradedCapabilities = (providerContract.capabilities ?? [])
    .filter((capability) => capability.status === "degraded");
  const blockedAnchors = (persistence.anchors ?? [])
    .filter((anchor) => anchor.status === "blocked");
  const pendingAnchors = (persistence.anchors ?? [])
    .filter((anchor) => !anchor.accepted && options.requireAnchorAcceptance !== false);
  const status = providerContract.status === "blocked" || persistence.status === "blocked"
    ? "blocked"
    : pendingAnchors.length || persistence.status === "pending"
      ? "pending"
      : degradedCapabilities.length || persistence.status === "review"
        ? "review"
        : "ready";

  return Object.freeze({
    version: "source-range-export-manifest.v1",
    status,
    ok: status === "ready" || status === "review",
    fileName: providerContract.fileName,
    providerId: providerContract.providerId,
    syncKey: persistence.syncKey ?? providerContract.syncMetadata.syncKey,
    restartSafe: persistence.restartSafe && blockedCapabilities.length === 0,
    counters: Object.freeze({
      capabilityByStatus: freezeSortedRecord(capabilityCounters),
      anchorByStatus: freezeSortedRecord(anchorCounters),
      handoffByChannel: freezeSortedRecord(handoffCounters),
    }),
    totals: Object.freeze({
      rangeCount: providerContract.index.entries.length,
      capabilityCount: providerContract.capabilities.length,
      anchorCount: persistence.anchors.length,
      blockedCapabilityCount: blockedCapabilities.length,
      degradedCapabilityCount: degradedCapabilities.length,
      blockedAnchorCount: blockedAnchors.length,
      pendingAnchorCount: pendingAnchors.length,
      externalRangeCount: (providerContract.externalHandoff?.ranges ?? [])
        .filter((range) => range.externalUri).length,
    }),
    capabilities: Object.freeze((providerContract.capabilities ?? []).map((capability) => Object.freeze({
      id: capability.id,
      required: capability.required,
      status: capability.status,
      handoff: capability.handoff,
      nextAction: capability.nextAction,
    }))),
    anchors: Object.freeze((persistence.anchors ?? []).map((anchor) => Object.freeze({
      id: anchor.id,
      type: anchor.type,
      name: anchor.name,
      compact: anchor.compact,
      status: anchor.status,
      accepted: anchor.accepted,
      restartSafe: anchor.restartSafe,
      nextAction: anchor.nextAction,
    }))),
    handoff: Object.freeze({
      status: providerContract.externalHandoff.status,
      externalRangeCount: (providerContract.externalHandoff?.ranges ?? []).length,
      syncKey: providerContract.externalHandoff.syncKey,
      nextAction: providerContract.externalHandoff.nextAction,
    }),
    recovery: Object.freeze({
      blockedCapabilityIds: Object.freeze(blockedCapabilities.map((capability) => capability.id).sort()),
      degradedCapabilityIds: Object.freeze(degradedCapabilities.map((capability) => capability.id).sort()),
      blockedAnchorIds: persistence.recovery.blockedAnchorIds,
      pendingAnchorIds: persistence.recovery.pendingAnchorIds,
      nextAction: blockedCapabilities[0]?.nextAction
        ?? blockedAnchors[0]?.nextAction
        ?? pendingAnchors[0]?.nextAction
        ?? degradedCapabilities[0]?.nextAction
        ?? persistence.recovery.nextAction
        ?? providerContract.externalHandoff.nextAction,
    }),
    exportSummary: Object.freeze({
      status,
      exportAllowed: status === "ready" || status === "review",
      restartSafe: persistence.restartSafe && blockedCapabilities.length === 0,
      syncKey: persistence.syncKey ?? providerContract.syncMetadata.syncKey,
      nextAction: status === "ready"
        ? "publish-source-range-export-manifest"
        : "resume-source-range-export-manifest",
    }),
  });
}

export function createMailchimpLaunchGateSourcePreview(nodes = [], launchGate = {}, options = {}) {
  const providerContract = options.providerContract ?? createSourceRangeProviderContract(nodes, {
    fileName: options.fileName,
    providerId: options.providerId ?? "mailchimp-launch-gate-source",
    revision: options.revision,
    externalBaseUri: options.externalBaseUri,
    capabilities: options.sourceCapabilities,
  });
  const persistence = options.persistence ?? createSourceRangePersistenceSnapshot(nodes, {
    fileName: providerContract.fileName,
    providerId: providerContract.providerId,
    revision: options.revision,
    externalBaseUri: options.externalBaseUri,
    capabilities: options.sourceCapabilities,
    previousAnchors: options.previousSourceAnchors,
    acceptedAnchorIds: options.acceptedSourceAnchorIds,
    requireAnchorAcceptance: options.requireSourceAnchorAcceptance,
  });
  const rangeByJobName = createRangeEntryByJobName(providerContract.index.entries);
  const acceptedGateIds = new Set((Array.isArray(options.acceptedMailchimpLaunchGateIds)
    ? options.acceptedMailchimpLaunchGateIds
    : [])
    .map((id) => String(id).trim())
    .filter(Boolean));
  const gatePreviews = (Array.isArray(launchGate.gates) ? launchGate.gates : []).map((gate) => {
    const rangeEntry = rangeByJobName[gate.jobName] ?? null;
    const accepted = acceptedGateIds.has(gate.id);
    const sourceAnchor = rangeEntry
      ? persistence.anchors.find((anchor) => anchor.compact === rangeEntry.compact) ?? null
      : null;
    const blocked = gate.status === "blocked" || providerContract.status === "blocked" || sourceAnchor?.status === "blocked";
    return Object.freeze({
      id: `launch-source:${gate.id}`,
      gateId: gate.id,
      jobName: gate.jobName,
      gateKind: gate.kind,
      status: blocked
        ? "blocked"
        : gate.status === "ready" && (accepted || options.requireLaunchGateAcceptance === false)
          ? "ready"
          : gate.status === "review"
            ? "review"
            : "pending",
      accepted,
      previewAddress: rangeEntry?.compact ?? null,
      range: rangeEntry?.range ?? null,
      sourceAnchorId: sourceAnchor?.id ?? null,
      sourceAnchorStatus: sourceAnchor?.status ?? "unbound",
      externalUri: providerContract.externalHandoff?.ranges
        ?.find((range) => range.previewAddress === rangeEntry?.compact)
        ?.externalUri ?? null,
      detail: gate.detail,
      nextAction: blocked
        ? gate.nextAction
        : accepted || options.requireLaunchGateAcceptance === false
          ? "retain-mailchimp-launch-gate-source"
          : "accept-mailchimp-launch-gate-source",
    });
  });
  const blocked = gatePreviews.filter((preview) => preview.status === "blocked");
  const pending = gatePreviews.filter((preview) => preview.status === "pending");
  const review = gatePreviews.filter((preview) => preview.status === "review");
  const status = providerContract.status === "blocked" || blocked.length
    ? "blocked"
    : pending.length || persistence.status === "pending"
      ? "pending"
      : review.length || persistence.status === "review"
        ? "review"
        : gatePreviews.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-launch-source-preview.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    fileName: providerContract.fileName,
    providerId: providerContract.providerId,
    syncKey: [
      providerContract.syncMetadata.syncKey,
      persistence.syncKey,
      launchGate.handoff?.syncKey ?? "mailchimp-launch-unbound",
    ].join("|"),
    previews: Object.freeze(gatePreviews.sort((left, right) => left.status.localeCompare(right.status) || left.gateId.localeCompare(right.gateId))),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(gatePreviews, "status")),
      byGateKind: freezeSortedRecord(countRangePreviewField(gatePreviews, "gateKind")),
      bySourceAnchorStatus: freezeSortedRecord(countRangePreviewField(gatePreviews, "sourceAnchorStatus")),
    }),
    acceptance: Object.freeze({
      mode: options.requireLaunchGateAcceptance === false ? "implicit" : "explicit",
      acceptable: status !== "blocked" && (options.requireLaunchGateAcceptance === false || pending.length === 0),
      requiredGateIds: Object.freeze(gatePreviews.map((preview) => preview.gateId).sort()),
      acceptedGateIds: Object.freeze([...acceptedGateIds].sort()),
      pendingGateIds: Object.freeze(options.requireLaunchGateAcceptance === false ? [] : pending.map((preview) => preview.gateId).sort()),
    }),
    handoff: Object.freeze({
      sourceProviderStatus: providerContract.status,
      sourcePersistenceStatus: persistence.status,
      externalRangeCount: (providerContract.externalHandoff?.ranges ?? []).filter((range) => range.externalUri).length,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? persistence.recovery.nextAction
        ?? providerContract.externalHandoff.nextAction,
    }),
    providerContract,
    persistence,
  });
}

export function createSourceRangeReleasePacket(nodes = [], options = {}) {
  const providerContract = options.providerContract ?? createSourceRangeProviderContract(nodes, {
    fileName: options.fileName,
    providerId: options.providerId,
    revision: options.revision,
    externalBaseUri: options.externalBaseUri,
    capabilities: options.sourceCapabilities ?? options.capabilities,
  });
  const persistence = options.persistence ?? createSourceRangePersistenceSnapshot(nodes, {
    fileName: providerContract.fileName,
    providerId: providerContract.providerId,
    revision: options.revision,
    externalBaseUri: options.externalBaseUri,
    capabilities: options.sourceCapabilities ?? options.capabilities,
    previousAnchors: options.previousSourceAnchors ?? options.previousAnchors,
    acceptedAnchorIds: options.acceptedSourceAnchorIds ?? options.acceptedAnchorIds,
    requireAnchorAcceptance: options.requireSourceAnchorAcceptance ?? options.requireAnchorAcceptance,
  });
  const manifest = options.manifest ?? createSourceRangeExportManifest(nodes, {
    fileName: providerContract.fileName,
    providerId: providerContract.providerId,
    revision: options.revision,
    externalBaseUri: options.externalBaseUri,
    capabilities: options.sourceCapabilities ?? options.capabilities,
    providerContract,
    persistence,
    requireAnchorAcceptance: options.requireSourceAnchorAcceptance ?? options.requireAnchorAcceptance,
  });
  const externalByPreviewAddress = new Map((providerContract.externalHandoff?.ranges ?? [])
    .map((range) => [range.previewAddress, range]));
  const anchorCards = (persistence.anchors ?? []).map((anchor) => {
    const external = externalByPreviewAddress.get(anchor.compact) ?? null;
    return Object.freeze({
      id: anchor.id,
      type: anchor.type,
      name: anchor.name,
      status: anchor.status,
      accepted: anchor.accepted,
      restartSafe: anchor.restartSafe,
      previewAddress: anchor.compact,
      externalUri: external?.externalUri ?? null,
      highlight: external?.highlight ?? null,
      idempotencyKey: anchor.idempotencyKey,
      userVisible: Object.freeze({
        label: anchor.name ? `${anchor.type} ${anchor.name}` : anchor.type,
        detail: external?.externalUri
          ? `Source preview is available at ${external.externalUri}.`
          : `Source preview is available at ${anchor.compact}.`,
        nextAction: anchor.nextAction,
      }),
    });
  }).sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id));
  const blocked = anchorCards.filter((anchor) => anchor.status === "blocked" || anchor.restartSafe === false);
  const pending = anchorCards.filter((anchor) => !anchor.accepted && options.requireSourceAnchorAcceptance !== false);
  const review = anchorCards.filter((anchor) => anchor.status === "changed");
  const status = providerContract.status === "blocked" || manifest.status === "blocked" || blocked.length
    ? "blocked"
    : manifest.status === "pending" || pending.length
      ? "pending"
      : manifest.status === "review" || review.length
        ? "review"
        : "ready";

  return Object.freeze({
    version: "source-range-release-packet.v1",
    status,
    ok: status === "ready" || status === "review",
    fileName: providerContract.fileName,
    providerId: providerContract.providerId,
    syncKey: [
      providerContract.syncMetadata.syncKey,
      persistence.syncKey,
      manifest.syncKey,
      options.revision ?? "working",
    ].join("|"),
    exportAllowed: status === "ready" || status === "review",
    restartSafe: manifest.restartSafe && blocked.length === 0,
    anchors: Object.freeze(anchorCards),
    counters: Object.freeze({
      anchorByStatus: freezeSortedRecord(countRangePreviewField(anchorCards, "status")),
      anchorByType: freezeSortedRecord(countRangePreviewField(anchorCards, "type")),
      capabilityByStatus: manifest.counters.capabilityByStatus,
    }),
    acceptance: Object.freeze({
      mode: options.requireSourceAnchorAcceptance === false ? "implicit" : "explicit",
      acceptable: status !== "blocked" && (options.requireSourceAnchorAcceptance === false || pending.length === 0),
      requiredAnchorIds: Object.freeze(anchorCards.map((anchor) => anchor.id).sort()),
      acceptedAnchorIds: Object.freeze(anchorCards.filter((anchor) => anchor.accepted).map((anchor) => anchor.id).sort()),
      pendingAnchorIds: Object.freeze(options.requireSourceAnchorAcceptance === false ? [] : pending.map((anchor) => anchor.id).sort()),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked" ? "source-ranges/recovery" : status === "pending" ? "source-ranges/acceptance" : "source-ranges/release",
      restartSafe: manifest.restartSafe && blocked.length === 0,
      blockedAnchorIds: Object.freeze(blocked.map((anchor) => anchor.id).sort()),
      pendingAnchorIds: Object.freeze(pending.map((anchor) => anchor.id).sort()),
      idempotencyKeys: Object.freeze(anchorCards
        .map((anchor) => anchor.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.userVisible.nextAction
        ?? pending[0]?.userVisible.nextAction
        ?? review[0]?.userVisible.nextAction
        ?? manifest.exportSummary.nextAction,
    }),
    handoff: Object.freeze({
      sourceProviderStatus: providerContract.status,
      persistenceStatus: persistence.status,
      manifestStatus: manifest.status,
      externalRangeCount: manifest.totals.externalRangeCount,
      nextAction: blocked[0]?.userVisible.nextAction
        ?? pending[0]?.userVisible.nextAction
        ?? manifest.recovery.nextAction,
    }),
    manifest,
  });
}

export function createSourceRangeTenantBoundaryAudit(nodes = [], options = {}) {
  const providerContract = options.providerContract ?? createSourceRangeProviderContract(nodes, {
    fileName: options.fileName,
    providerId: options.providerId,
    revision: options.revision,
    externalBaseUri: options.externalBaseUri,
    capabilities: options.sourceCapabilities ?? options.capabilities,
  });
  const persistence = options.persistence ?? createSourceRangePersistenceSnapshot(nodes, {
    fileName: providerContract.fileName,
    providerId: providerContract.providerId,
    revision: options.revision,
    externalBaseUri: options.externalBaseUri,
    capabilities: options.sourceCapabilities ?? options.capabilities,
    previousAnchors: options.previousSourceAnchors ?? options.previousAnchors,
    acceptedAnchorIds: options.acceptedSourceAnchorIds ?? options.acceptedAnchorIds,
    requireAnchorAcceptance: options.requireSourceAnchorAcceptance ?? options.requireAnchorAcceptance,
  });
  const boundary = normalizeSourceRangeBoundaryOptions(options);
  const mailchimpTenantCorrelations = options.mailchimpTenantSourceAnchorCorrelations?.version === "mailchimp-tenant-source-anchor-correlations.v1"
    ? options.mailchimpTenantSourceAnchorCorrelations
    : options.tenantPermissionDecision || options.mailchimpTenantPermissionDecision
      ? createMailchimpTenantSourceAnchorCorrelations(
          options.tenantPermissionDecision ?? options.mailchimpTenantPermissionDecision,
          persistence.anchors,
          options,
        )
      : null;
  const correlationByAnchorId = new Map((mailchimpTenantCorrelations?.rows ?? [])
    .filter((row) => row.anchorId)
    .map((row) => [row.anchorId, row]));
  const unanchoredMailchimpRows = (mailchimpTenantCorrelations?.rows ?? [])
    .filter((row) => !row.anchorId && row.auditRowId);
  const auditEvents = persistence.anchors.map((anchor) => createSourceRangeBoundaryAuditEvent(anchor, {
    boundary,
    providerContract,
    revision: options.revision ?? "working",
    mailchimpTenantCorrelation: correlationByAnchorId.get(anchor.id) ?? null,
  }));
  const mailchimpUnanchoredEvents = unanchoredMailchimpRows.map((row) => createSourceRangeMailchimpUnanchoredBoundaryEvent(row, {
    providerContract,
    boundary,
    revision: options.revision ?? "working",
  }));
  const allAuditEvents = Object.freeze([...auditEvents, ...mailchimpUnanchoredEvents]
    .sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id)));
  const blocked = allAuditEvents.filter((event) => event.status === "blocked");
  const review = allAuditEvents.filter((event) => event.status === "review");
  const pending = allAuditEvents.filter((event) => event.status === "pending");
  const diagnostics = blocked.map((event) => createCatalogDiagnostic("AIOS_SOURCE_RANGE", {
    message: `Source range boundary row "${event.anchorId ?? event.mailchimpAuditRowId ?? event.id}" is outside the source boundary: ${event.reason}.`,
    hint: `Recovery: ${event.nextAction}; handoff: source-range-boundary-audit.`,
    preview: event.previewAddress,
  }));
  const status = providerContract.status === "blocked" || persistence.status === "blocked" || blocked.length
    ? "blocked"
    : pending.length || persistence.status === "pending"
      ? "pending"
      : review.length || persistence.status === "review"
        ? "review"
        : "ready";

  return Object.freeze({
    version: "source-range-tenant-boundary-audit.v1",
    status,
    ok: status === "ready" || status === "review",
    exportAllowed: status === "ready" || status === "review",
    fileName: providerContract.fileName,
    providerId: providerContract.providerId,
    syncKey: [
      providerContract.syncMetadata.syncKey,
      persistence.syncKey,
      boundary.tenantId ?? "tenant-unbound",
      boundary.workspaceId ?? "workspace-unbound",
      mailchimpTenantCorrelations?.syncKey ?? "mailchimp-tenant-unbound",
    ].join("|"),
    boundary,
    auditEvents: allAuditEvents,
    mailchimpTenantCorrelations,
    diagnostics: Object.freeze(diagnostics),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(allAuditEvents, "status")),
      byRole: freezeSortedRecord(countRangePreviewField(allAuditEvents, "role")),
      byWorkspace: freezeSortedRecord(countRangePreviewField(allAuditEvents, "workspaceId")),
      byMailchimpTenantStatus: mailchimpTenantCorrelations?.counters?.byStatus ?? Object.freeze({}),
    }),
    recovery: Object.freeze({
      blockedAnchorIds: Object.freeze(blocked.map((event) => event.anchorId).filter(Boolean).sort()),
      pendingAnchorIds: Object.freeze(pending.map((event) => event.anchorId).filter(Boolean).sort()),
      reviewAnchorIds: Object.freeze(review.map((event) => event.anchorId).filter(Boolean).sort()),
      blockedMailchimpAuditRowIds: Object.freeze(blocked.map((event) => event.mailchimpAuditRowId).filter(Boolean).sort()),
      pendingMailchimpAuditRowIds: Object.freeze(pending.map((event) => event.mailchimpAuditRowId).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? persistence.recovery.nextAction,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "source-ranges/boundary-recovery"
        : status === "pending"
          ? "source-ranges/boundary-acceptance"
          : status === "review"
            ? "source-ranges/boundary-review"
            : "source-ranges/boundary-summary",
      restartSafe: blocked.length === 0 && persistence.restartSafe,
      idempotencyKeys: Object.freeze(auditEvents
        .map((event) => event.idempotencyKey)
        .concat(mailchimpUnanchoredEvents.map((event) => event.idempotencyKey))
        .concat(mailchimpTenantCorrelations?.handoff?.idempotencyKeys ?? [])
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-source-range-boundary-audit",
    }),
    providerContract,
    persistence,
  });
}

export function createSourceRangeOperationalTimeline(state = {}, options = {}) {
  const providerContract = state.providerContract ?? state.sourceProvider ?? null;
  const persistence = state.persistence ?? state.sourcePersistence ?? null;
  const manifest = state.manifest ?? state.sourceExportManifest ?? null;
  const releasePacket = state.releasePacket ?? state.sourceReleasePacket ?? null;
  const boundaryAudit = state.boundaryAudit ?? state.sourceBoundaryAudit ?? null;
  const events = [
    sourceRangeOperationalEvent({
      phase: "provider",
      status: providerContract?.status ?? "unbound",
      route: "source-ranges/provider",
      count: providerContract?.index?.entries?.length ?? 0,
      restartSafe: providerContract?.status !== "blocked",
      idempotencyKey: providerContract?.syncMetadata?.syncKey ?? null,
      blockedIds: (providerContract?.capabilities ?? [])
        .filter((capability) => capability.status === "blocked")
        .map((capability) => capability.id),
      pendingIds: [],
      nextAction: providerContract?.externalHandoff?.nextAction ?? "build-source-range-provider-contract",
    }),
    sourceRangeOperationalEvent({
      phase: "persistence",
      status: persistence?.status ?? "unbound",
      route: persistence?.status === "blocked"
        ? "source-ranges/persistence-recovery"
        : persistence?.status === "pending"
          ? "source-ranges/persistence-acceptance"
          : "source-ranges/persistence",
      count: persistence?.anchors?.length ?? 0,
      restartSafe: persistence?.restartSafe !== false,
      idempotencyKey: persistence?.syncKey ?? null,
      blockedIds: persistence?.recovery?.blockedAnchorIds ?? [],
      pendingIds: persistence?.recovery?.pendingAnchorIds ?? [],
      reviewIds: persistence?.recovery?.changedAnchorIds ?? [],
      nextAction: persistence?.recovery?.nextAction ?? "create-source-range-persistence-snapshot",
    }),
    sourceRangeOperationalEvent({
      phase: "manifest",
      status: manifest?.status ?? "unbound",
      route: "source-ranges/export-manifest",
      count: manifest?.totals?.rangeCount ?? 0,
      restartSafe: manifest?.restartSafe !== false,
      idempotencyKey: manifest?.syncKey ?? null,
      blockedIds: manifest?.recovery?.blockedAnchorIds ?? [],
      pendingIds: manifest?.recovery?.pendingAnchorIds ?? [],
      reviewIds: manifest?.recovery?.degradedCapabilityIds ?? [],
      nextAction: manifest?.recovery?.nextAction ?? "create-source-range-export-manifest",
    }),
    sourceRangeOperationalEvent({
      phase: "release",
      status: releasePacket?.status ?? "unbound",
      route: releasePacket?.restartEnvelope?.route ?? "source-ranges/release",
      count: releasePacket?.anchors?.length ?? 0,
      restartSafe: releasePacket?.restartSafe !== false,
      idempotencyKey: releasePacket?.syncKey ?? null,
      blockedIds: releasePacket?.restartEnvelope?.blockedAnchorIds ?? [],
      pendingIds: releasePacket?.restartEnvelope?.pendingAnchorIds ?? [],
      nextAction: releasePacket?.restartEnvelope?.nextAction ?? "create-source-range-release-packet",
    }),
    sourceRangeOperationalEvent({
      phase: "boundary",
      status: boundaryAudit?.status ?? "unbound",
      route: boundaryAudit?.restartEnvelope?.route ?? "source-ranges/boundary-summary",
      count: boundaryAudit?.auditEvents?.length ?? 0,
      restartSafe: boundaryAudit?.restartEnvelope?.restartSafe !== false,
      idempotencyKey: boundaryAudit?.syncKey ?? null,
      blockedIds: boundaryAudit?.recovery?.blockedAnchorIds ?? [],
      pendingIds: boundaryAudit?.recovery?.pendingAnchorIds ?? [],
      reviewIds: boundaryAudit?.recovery?.reviewAnchorIds ?? [],
      nextAction: boundaryAudit?.restartEnvelope?.nextAction ?? boundaryAudit?.recovery?.nextAction ?? "publish-source-range-boundary-audit",
    }),
  ];
  const actionableEvents = events.filter((event) => event.status !== "ready" && event.status !== "idle" && event.status !== "unbound");
  const blocked = events.filter((event) => event.status === "blocked" || event.restartSafe === false);
  const pending = events.filter((event) => event.status === "pending");
  const review = events.filter((event) => event.status === "review" || event.status === "degraded" || event.reviewIds.length);
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : events.some((event) => event.status === "ready")
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "source-range-operational-timeline.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    fileName: options.fileName ?? providerContract?.fileName ?? persistence?.fileName ?? manifest?.fileName ?? releasePacket?.fileName ?? "inline.aios",
    providerId: options.providerId ?? providerContract?.providerId ?? persistence?.providerId ?? manifest?.providerId ?? releasePacket?.providerId ?? "aios-source-range-provider",
    restartSafe: blocked.length === 0 && events.every((event) => event.restartSafe),
    exportAllowed: status === "ready" || status === "review" || status === "idle",
    events: Object.freeze(events.map((event, index) => Object.freeze({ ...event, index }))),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(events, "status")),
      byRoute: freezeSortedRecord(countRangePreviewField(events, "route")),
      byPhase: freezeSortedRecord(countRangePreviewField(events, "phase")),
    }),
    totals: Object.freeze({
      eventCount: events.length,
      actionableEventCount: actionableEvents.length,
      blockedEventCount: blocked.length,
      pendingEventCount: pending.length,
      reviewEventCount: review.length,
      blockedIdCount: events.reduce((total, event) => total + event.blockedIds.length, 0),
      pendingIdCount: events.reduce((total, event) => total + event.pendingIds.length, 0),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "source-ranges/operational-recovery"
        : status === "pending"
          ? "source-ranges/operational-acceptance"
          : status === "review"
            ? "source-ranges/operational-review"
            : "source-ranges/operational-summary",
      restartSafe: blocked.length === 0 && events.every((event) => event.restartSafe),
      blockedEventIds: Object.freeze(blocked.map((event) => event.id).sort()),
      pendingEventIds: Object.freeze(pending.map((event) => event.id).sort()),
      reviewEventIds: Object.freeze(review.map((event) => event.id).sort()),
      idempotencyKeys: Object.freeze(events
        .map((event) => event.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? actionableEvents[0]?.nextAction
        ?? "publish-source-range-operational-timeline",
    }),
  });
}

export function createSourceRangeProviderExportSummary(state = {}, options = {}) {
  const providerContract = state.providerContract ?? state.sourceProvider ?? null;
  const persistence = state.persistence ?? state.sourcePersistence ?? null;
  const manifest = state.manifest ?? state.sourceExportManifest ?? null;
  const boundaryAudit = state.boundaryAudit ?? state.sourceBoundaryAudit ?? null;
  const timeline = state.timeline?.version === "source-range-operational-timeline.v1"
    ? state.timeline
    : createSourceRangeOperationalTimeline(state, options);
  const capabilityRows = (providerContract?.capabilities ?? manifest?.capabilities ?? []).map((capability) => Object.freeze({
    id: capability.id,
    required: capability.required !== false,
    status: capability.status ?? "unknown",
    handoff: capability.handoff ?? "source-range-provider",
    nextAction: capability.nextAction ?? "review-source-range-capability",
  }));
  const anchorRows = (persistence?.anchors ?? manifest?.anchors ?? []).map((anchor) => Object.freeze({
    id: anchor.id,
    type: anchor.type,
    name: anchor.name,
    status: anchor.status ?? "unknown",
    accepted: anchor.accepted === true,
    restartSafe: anchor.restartSafe !== false,
    previewAddress: anchor.compact ?? anchor.previewAddress ?? null,
    nextAction: anchor.nextAction ?? "review-source-range-anchor",
  }));
  const externalRows = (providerContract?.externalHandoff?.ranges ?? []).map((range) => Object.freeze({
    id: `${range.type}:${range.name ?? "anonymous"}:${range.previewAddress}`,
    type: range.type,
    name: range.name,
    status: range.externalUri ? "external" : "local",
    previewAddress: range.previewAddress,
    externalUri: range.externalUri ?? null,
    highlight: range.highlight ?? null,
  }));
  const blockedCapabilities = capabilityRows.filter((capability) => capability.status === "blocked");
  const degradedCapabilities = capabilityRows.filter((capability) => capability.status === "degraded");
  const blockedAnchors = anchorRows.filter((anchor) => anchor.status === "blocked" || anchor.restartSafe === false);
  const pendingAnchors = anchorRows.filter((anchor) => !anchor.accepted && options.requireSourceAnchorAcceptance !== false);
  const boundaryRows = createSourceRangeProviderBoundarySummaryRows(boundaryAudit);
  const blockedBoundaryRows = boundaryRows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pendingBoundaryRows = boundaryRows.filter((row) => row.status === "pending");
  const reviewBoundaryRows = boundaryRows.filter((row) => row.status === "review");
  const status = providerContract?.status === "blocked" || manifest?.status === "blocked" || boundaryAudit?.status === "blocked" || blockedCapabilities.length || blockedAnchors.length || blockedBoundaryRows.length
    ? "blocked"
    : manifest?.status === "pending" || boundaryAudit?.status === "pending" || pendingAnchors.length || pendingBoundaryRows.length || timeline.status === "pending"
      ? "pending"
      : degradedCapabilities.length || manifest?.status === "review" || boundaryAudit?.status === "review" || reviewBoundaryRows.length || timeline.status === "review"
        ? "review"
        : providerContract || manifest || persistence
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "source-range-provider-export-summary.v1",
    status,
    ok: status === "ready" || status === "review" || status === "idle",
    exportAllowed: status === "ready" || status === "review" || status === "idle",
    fileName: options.fileName ?? providerContract?.fileName ?? persistence?.fileName ?? manifest?.fileName ?? timeline.fileName,
    providerId: options.providerId ?? providerContract?.providerId ?? persistence?.providerId ?? manifest?.providerId ?? timeline.providerId,
    syncKey: [
      providerContract?.syncMetadata?.syncKey ?? manifest?.syncKey ?? persistence?.syncKey ?? "source-range",
      timeline.restartEnvelope.idempotencyKeys.join(",") || "no-timeline-events",
      options.revision ?? "working",
    ].join("|"),
    counters: Object.freeze({
      capabilityByStatus: freezeSortedRecord(countRangePreviewField(capabilityRows, "status")),
      anchorByStatus: freezeSortedRecord(countRangePreviewField(anchorRows, "status")),
      externalByStatus: freezeSortedRecord(countRangePreviewField(externalRows, "status")),
      boundaryByStatus: freezeSortedRecord(countRangePreviewField(boundaryRows, "status")),
      boundaryByWorkspace: freezeSortedRecord(countRangePreviewField(boundaryRows, "workspaceId")),
      timelineByStatus: timeline.counters.byStatus,
      timelineByPhase: timeline.counters.byPhase,
    }),
    totals: Object.freeze({
      capabilityCount: capabilityRows.length,
      anchorCount: anchorRows.length,
      externalRangeCount: externalRows.filter((row) => row.externalUri).length,
      blockedCapabilityCount: blockedCapabilities.length,
      degradedCapabilityCount: degradedCapabilities.length,
      blockedAnchorCount: blockedAnchors.length,
      pendingAnchorCount: pendingAnchors.length,
      boundaryAuditCount: boundaryRows.length,
      blockedBoundaryCount: blockedBoundaryRows.length,
      pendingBoundaryCount: pendingBoundaryRows.length,
      reviewBoundaryCount: reviewBoundaryRows.length,
      operationalEventCount: timeline.totals.eventCount,
      actionableEventCount: timeline.totals.actionableEventCount,
    }),
    capabilities: Object.freeze(capabilityRows.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    anchors: Object.freeze(anchorRows.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    externalRanges: Object.freeze(externalRows.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    boundaryAudit: Object.freeze({
      status: boundaryAudit?.status ?? "unbound",
      exportAllowed: boundaryAudit?.exportAllowed !== false,
      restartSafe: boundaryAudit?.restartEnvelope?.restartSafe !== false,
      syncKey: boundaryAudit?.syncKey ?? null,
      rows: Object.freeze(boundaryRows.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    }),
    recovery: Object.freeze({
      blockedCapabilityIds: Object.freeze(blockedCapabilities.map((capability) => capability.id).sort()),
      degradedCapabilityIds: Object.freeze(degradedCapabilities.map((capability) => capability.id).sort()),
      blockedAnchorIds: Object.freeze(blockedAnchors.map((anchor) => anchor.id).sort()),
      pendingAnchorIds: Object.freeze(pendingAnchors.map((anchor) => anchor.id).sort()),
      blockedBoundaryIds: Object.freeze(blockedBoundaryRows.map((row) => row.id).sort()),
      pendingBoundaryIds: Object.freeze(pendingBoundaryRows.map((row) => row.id).sort()),
      reviewBoundaryIds: Object.freeze(reviewBoundaryRows.map((row) => row.id).sort()),
      nextAction: blockedCapabilities[0]?.nextAction
        ?? blockedAnchors[0]?.nextAction
        ?? blockedBoundaryRows[0]?.nextAction
        ?? pendingAnchors[0]?.nextAction
        ?? pendingBoundaryRows[0]?.nextAction
        ?? reviewBoundaryRows[0]?.nextAction
        ?? degradedCapabilities[0]?.nextAction
        ?? timeline.restartEnvelope.nextAction,
    }),
    handoff: Object.freeze({
      route: status === "blocked"
        ? "source-ranges/provider-export-recovery"
        : status === "pending"
          ? "source-ranges/provider-export-acceptance"
          : status === "review"
            ? "source-ranges/provider-export-review"
            : "source-ranges/provider-export-summary",
      restartSafe: blockedCapabilities.length === 0 && blockedAnchors.length === 0 && blockedBoundaryRows.length === 0 && timeline.restartEnvelope.restartSafe,
      idempotencyKeys: timeline.restartEnvelope.idempotencyKeys,
      nextAction: blockedCapabilities[0]?.nextAction
        ?? blockedAnchors[0]?.nextAction
        ?? blockedBoundaryRows[0]?.nextAction
        ?? pendingAnchors[0]?.nextAction
        ?? pendingBoundaryRows[0]?.nextAction
        ?? timeline.restartEnvelope.nextAction,
    }),
    timeline,
  });
}

export function createSourceRangeFailureRecoveryState(state = {}, options = {}) {
  const providerContract = state.providerContract ?? state.sourceProvider ?? null;
  const persistence = state.persistence ?? state.sourcePersistence ?? null;
  const manifest = state.manifest ?? state.sourceExportManifest ?? null;
  const releasePacket = state.releasePacket ?? state.sourceReleasePacket ?? null;
  const boundaryAudit = state.boundaryAudit ?? state.sourceBoundaryAudit ?? null;
  const timeline = state.timeline?.version === "source-range-operational-timeline.v1"
    ? state.timeline
    : createSourceRangeOperationalTimeline(state, options);
  const sourceAnchorHandoff = state.sourceAnchorHandoff ?? state.mailchimpSourceAnchorHandoff ?? null;
  const commandState = normalizeSourceRangeRecoveryCommandState(options);
  const context = {
    fileName: options.fileName
      ?? providerContract?.fileName
      ?? persistence?.fileName
      ?? manifest?.fileName
      ?? timeline.fileName
      ?? "inline.aios",
    providerId: options.providerId
      ?? providerContract?.providerId
      ?? persistence?.providerId
      ?? manifest?.providerId
      ?? timeline.providerId
      ?? "aios-source-range-provider",
    revision: options.revision ?? "working",
    degradedMode: options.sourceRangeDegradedMode === true || options.degradedMode === true,
    maxAttempts: normalizeRecoveryAttemptLimit(options.sourceRangeMaxRetryAttempts ?? options.maxRetryAttempts),
    baseDelaySeconds: normalizeRecoveryBackoffSeconds(options.sourceRangeRetryBaseSeconds ?? options.retryBaseSeconds),
    commandState,
  };
  const rows = Object.freeze(dedupeSourceRangeFailureRows([
    ...createSourceRangeCapabilityFailureRows(providerContract, context),
    ...createSourceRangeAnchorFailureRows(persistence, manifest, context),
    ...createSourceRangeBoundaryFailureRows(boundaryAudit, context),
    ...createSourceRangeTimelineFailureRows(timeline, context),
    ...createSourceRangeMailchimpFailureRows(sourceAnchorHandoff, context),
    ...createSourceRangeReleaseFailureRows(releasePacket, context),
  ]).sort(compareSourceRangeFailureRows));
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review" || row.status === "degraded");
  const ready = rows.filter((row) => row.status === "ready");
  const status = blocked.length
    ? context.degradedMode && blocked.every((row) => row.degradedAllowed)
      ? "degraded"
      : "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : rows.length || providerContract || persistence || manifest
          ? "ready"
          : "idle";
  const actionable = rows.filter((row) => row.status !== "ready");

  return Object.freeze({
    version: "source-range-failure-recovery.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review" || status === "degraded",
    exportAllowed: status === "ready" || status === "idle" || status === "review" || status === "degraded",
    restartSafe: blocked.length === 0 || status === "degraded",
    degradedMode: context.degradedMode,
    fileName: context.fileName,
    providerId: context.providerId,
    revision: context.revision,
    syncKey: [
      context.fileName,
      context.providerId,
      context.revision,
      rows.map((row) => row.idempotencyKey).join(".") || "no-failures",
    ].join("|"),
    rows,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(rows, "status")),
      byKind: freezeSortedRecord(countRangePreviewField(rows, "kind")),
      byRoute: freezeSortedRecord(countRangePreviewField(rows, "route")),
      byNextAction: freezeSortedRecord(countRangePreviewField(actionable, "nextAction")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      readyCount: ready.length,
      retryableCount: rows.filter((row) => row.retryable).length,
      exhaustedCount: rows.filter((row) => row.exhausted).length,
      degradedAllowedCount: rows.filter((row) => row.degradedAllowed).length,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "source-ranges/failure-recovery"
        : status === "degraded"
          ? "source-ranges/failure-recovery/degraded"
          : status === "pending"
            ? "source-ranges/failure-recovery/retry"
            : status === "review"
              ? "source-ranges/failure-recovery/review"
              : "source-ranges/failure-recovery/summary",
      restartSafe: blocked.length === 0 || status === "degraded",
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-source-range-failure-recovery-state",
    }),
    userVisible: Object.freeze({
      title: "Source range recovery",
      detail: status === "ready" || status === "idle"
        ? "Source ranges have no actionable recovery rows."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review source recovery rows remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-source-range-failure-recovery-state",
    }),
  });
}

export function createSourceRangeRecoveryCommandExport(recoveryState = {}, options = {}) {
  const state = recoveryState?.version === "source-range-failure-recovery.v1"
    ? recoveryState
    : createSourceRangeFailureRecoveryState(recoveryState, options);
  const requested = normalizeSourceRangeHandoffIdSet(options.requestedSourceRangeRecoveryCommandIds ?? options.queuedSourceRangeRecoveryIds);
  const completed = normalizeSourceRangeHandoffIdSet(options.completedSourceRangeRecoveryCommandIds ?? options.completedSourceRangeRecoveryIds);
  const failed = normalizeSourceRangeHandoffIdSet(options.failedSourceRangeRecoveryCommandIds ?? options.failedSourceRangeRecoveryIds);
  const accepted = normalizeSourceRangeHandoffIdSet(options.acceptedSourceRangeRecoveryCommandIds ?? options.acceptedSourceRangeRecoveryIds);
  const requireAcceptance = options.requireSourceRangeRecoveryCommandAcceptance !== false;
  const commandRows = Object.freeze((state.rows ?? []).map((row) => createSourceRangeRecoveryCommandExportRow(row, {
    state,
    requested,
    completed,
    failed,
    accepted,
    requireAcceptance,
  })).sort(compareSourceRangeRecoveryCommandRows));
  const blocked = commandRows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = commandRows.filter((row) => row.status === "pending" || row.status === "needsAcceptance");
  const review = commandRows.filter((row) => row.status === "review" || row.status === "degraded");
  const ready = commandRows.filter((row) => row.status === "ready");
  const status = state.status === "blocked" || blocked.length
    ? "blocked"
    : state.status === "pending" || pending.length
      ? "pending"
      : state.status === "review" || state.status === "degraded" || review.length
        ? "review"
        : commandRows.length || state.status === "ready"
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "source-range-recovery-command-export.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || status === "idle" || (status === "review" && options.allowReviewSourceRangeRecoveryCommands === true),
    restartSafe: blocked.length === 0 && state.restartEnvelope?.restartSafe !== false,
    degradedMode: state.degradedMode === true,
    fileName: state.fileName ?? options.fileName ?? "inline.aios",
    providerId: state.providerId ?? options.providerId ?? "aios-source-range-provider",
    revision: state.revision ?? options.revision ?? "working",
    syncKey: [
      state.syncKey ?? "source-range-recovery",
      commandRows.map((row) => `${row.commandId}:${row.status}`).join(".") || "no-recovery-commands",
      options.revision ?? state.revision ?? "working",
    ].join("|"),
    commands: commandRows,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(commandRows, "status")),
      byIntent: freezeSortedRecord(countRangePreviewField(commandRows, "intent")),
      byRoute: freezeSortedRecord(countRangePreviewField(commandRows, "route")),
      byTargetKind: freezeSortedRecord(countRangePreviewField(commandRows, "targetKind")),
    }),
    totals: Object.freeze({
      commandCount: commandRows.length,
      readyCommandCount: ready.length,
      blockedCommandCount: blocked.length,
      pendingCommandCount: pending.length,
      reviewCommandCount: review.length,
      retryCommandCount: commandRows.filter((row) => row.intent === "retry").length,
      degradedCommandCount: commandRows.filter((row) => row.intent === "degraded").length,
      acceptedCommandCount: commandRows.filter((row) => row.accepted).length,
      completedCommandCount: commandRows.filter((row) => row.completed).length,
    }),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: status !== "blocked" && (!requireAcceptance || pending.length === 0),
      requiredCommandIds: Object.freeze(commandRows.map((row) => row.commandId).sort()),
      acceptedCommandIds: Object.freeze(commandRows.filter((row) => row.accepted).map((row) => row.commandId).sort()),
      pendingCommandIds: Object.freeze(requireAcceptance ? pending.map((row) => row.commandId).sort() : []),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "source-ranges/recovery-commands/repair"
        : status === "pending"
          ? "source-ranges/recovery-commands/acceptance"
          : status === "review"
            ? "source-ranges/recovery-commands/review"
            : "source-ranges/recovery-commands/export",
      restartSafe: blocked.length === 0 && state.restartEnvelope?.restartSafe !== false,
      blockedCommandIds: Object.freeze(blocked.map((row) => row.commandId).sort()),
      pendingCommandIds: Object.freeze(pending.map((row) => row.commandId).sort()),
      reviewCommandIds: Object.freeze(review.map((row) => row.commandId).sort()),
      idempotencyKeys: Object.freeze(commandRows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? state.restartEnvelope?.nextAction
        ?? "publish-source-range-recovery-command-export",
    }),
    recoveryState: state,
  });
}

export function createSourceRangeRecoveryReadinessDigest(state = {}, options = {}) {
  const recoveryState = state.recoveryState?.version === "source-range-failure-recovery.v1"
    ? state.recoveryState
    : state.sourceRangeFailureRecoveryState?.version === "source-range-failure-recovery.v1"
      ? state.sourceRangeFailureRecoveryState
      : state.version === "source-range-failure-recovery.v1"
        ? state
        : createSourceRangeFailureRecoveryState(state, options);
  const commandExport = state.commandExport?.version === "source-range-recovery-command-export.v1"
    ? state.commandExport
    : state.sourceRangeRecoveryCommandExport?.version === "source-range-recovery-command-export.v1"
      ? state.sourceRangeRecoveryCommandExport
      : state.version === "source-range-recovery-command-export.v1"
        ? state
        : createSourceRangeRecoveryCommandExport(recoveryState, options);
  const acknowledged = normalizeSourceRangeHandoffIdSet(
    options.acknowledgedSourceRangeRecoveryDigestIds
      ?? options.acceptedSourceRangeRecoveryDigestIds,
  );
  const digestRows = Object.freeze(createSourceRangeRecoveryDigestRows(recoveryState, commandExport, {
    acknowledged,
    requireAcknowledgement: options.requireSourceRangeRecoveryDigestAcknowledgement !== false,
  }).sort(compareSourceRangeRecoveryDigestRows));
  const blocked = digestRows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = digestRows.filter((row) => row.status === "pending");
  const review = digestRows.filter((row) => row.status === "review" || row.status === "degraded");
  const ready = digestRows.filter((row) => row.status === "ready");
  const status = recoveryState.status === "blocked" || commandExport.status === "blocked" || blocked.length
    ? "blocked"
    : recoveryState.status === "pending" || commandExport.status === "pending" || pending.length
      ? "pending"
      : recoveryState.status === "degraded" || recoveryState.status === "review" || commandExport.status === "review" || review.length
        ? "review"
        : digestRows.length || recoveryState.status === "ready" || commandExport.status === "ready"
          ? "ready"
          : "idle";
  const diagnostics = Object.freeze(blocked.map((row) => createCatalogDiagnostic(
    row.kind === "commandSettlement"
      ? "AIOS_SOURCE_RANGE_RECOVERY_COMMAND_EXPORT"
      : "AIOS_SOURCE_RANGE_FAILURE_RECOVERY",
    {
      severity: "error",
      message: `Source range recovery digest row "${row.id}" is not ready for formatter handoff.`,
      hint: `Recovery: ${row.nextAction}; handoff: source-range-recovery-readiness.`,
      preview: row.previewAddress ?? row.targetId ?? row.id,
      recoveryDigest: Object.freeze({
        rowId: row.id,
        kind: row.kind,
        status: row.status,
        nextAction: row.nextAction,
      }),
    },
  )));

  return Object.freeze({
    version: "source-range-recovery-readiness-digest.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || status === "idle" || (status === "review" && options.allowReviewSourceRangeRecoveryDigest === true),
    restartSafe: blocked.length === 0
      && recoveryState.restartEnvelope?.restartSafe !== false
      && commandExport.restartEnvelope?.restartSafe !== false,
    degradedMode: recoveryState.degradedMode === true || commandExport.degradedMode === true,
    fileName: options.fileName ?? recoveryState.fileName ?? commandExport.fileName ?? "inline.aios",
    providerId: options.providerId ?? recoveryState.providerId ?? commandExport.providerId ?? "aios-source-range-provider",
    revision: options.revision ?? recoveryState.revision ?? commandExport.revision ?? "working",
    syncKey: [
      recoveryState.syncKey ?? "source-range-recovery-unbound",
      commandExport.syncKey ?? "source-range-recovery-command-unbound",
      digestRows.map((row) => row.idempotencyKey).join(".") || "digest-empty",
    ].join("|"),
    rows: digestRows,
    diagnostics,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(digestRows, "status")),
      byKind: freezeSortedRecord(countRangePreviewField(digestRows, "kind")),
      byRoute: freezeSortedRecord(countRangePreviewField(digestRows, "route")),
      byNextAction: freezeSortedRecord(countRangePreviewField(
        digestRows.filter((row) => row.status !== "ready"),
        "nextAction",
      )),
    }),
    totals: Object.freeze({
      rowCount: digestRows.length,
      readyCount: ready.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      acknowledgedCount: digestRows.filter((row) => row.acknowledged).length,
      retryableCount: digestRows.filter((row) => row.retryable).length,
      degradedAllowedCount: digestRows.filter((row) => row.degradedAllowed).length,
      diagnosticCount: diagnostics.length,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "source-ranges/recovery-readiness/repair"
        : status === "pending"
          ? "source-ranges/recovery-readiness/acknowledgement"
          : status === "review"
            ? "source-ranges/recovery-readiness/review"
            : "source-ranges/recovery-readiness/export",
      restartSafe: blocked.length === 0
        && recoveryState.restartEnvelope?.restartSafe !== false
        && commandExport.restartEnvelope?.restartSafe !== false,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(digestRows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? commandExport.restartEnvelope?.nextAction
        ?? recoveryState.restartEnvelope?.nextAction
        ?? "publish-source-range-recovery-readiness-digest",
    }),
    recoveryState,
    commandExport,
  });
}

export function createMailchimpSourceAnchorHandoffContract(state = {}, mailchimpHandoff = {}, options = {}) {
  const providerContract = state.providerContract ?? state.sourceProvider ?? null;
  const persistence = state.persistence ?? state.sourcePersistence ?? null;
  const manifest = state.manifest ?? state.sourceExportManifest ?? null;
  const releasePacket = state.releasePacket ?? state.sourceReleasePacket ?? null;
  const providerSummary = state.providerSummary ?? state.sourceProviderExportSummary ?? null;
  const operations = Array.isArray(mailchimpHandoff.operations) ? mailchimpHandoff.operations : [];
  const requireAcceptance = options.requireSourceAnchorAcceptance !== false;
  const externalByPreviewAddress = new Map((providerContract?.externalHandoff?.ranges ?? [])
    .map((range) => [range.previewAddress, range]));
  const anchorsByJobName = createMailchimpSourceAnchorRows({
    providerContract,
    persistence,
    manifest,
    releasePacket,
    externalByPreviewAddress,
  });
  const operationAnchors = operations.map((operation) => createMailchimpOperationSourceAnchor(operation, {
    anchorsByJobName,
    requireAcceptance,
    providerStatus: providerContract?.status ?? providerSummary?.status ?? "unbound",
    providerSummary,
  }));
  const orphanAnchors = [...anchorsByJobName.values()]
    .filter((anchor) => !operationAnchors.some((operationAnchor) => operationAnchor.anchorId === anchor.id));
  const blocked = operationAnchors.filter((anchor) => anchor.status === "blocked");
  const pending = operationAnchors.filter((anchor) => anchor.status === "pending");
  const review = operationAnchors.filter((anchor) => anchor.status === "review");
  const diagnostics = blocked.map((anchor) => createCatalogDiagnostic("AIOS_MAILCHIMP_SOURCE_ANCHOR", {
    severity: "error",
    message: `Mailchimp operation "${anchor.operationId}" cannot hand off without an accepted source anchor.`,
    hint: `Recovery: ${anchor.nextAction}; handoff: mailchimp-source-anchor.`,
    preview: anchor.previewAddress ?? anchor.jobName ?? anchor.operationId,
    range: anchor.range ?? null,
    sourceAnchor: Object.freeze({
      operationId: anchor.operationId,
      jobName: anchor.jobName,
      anchorId: anchor.anchorId,
      status: anchor.status,
      nextAction: anchor.nextAction,
    }),
  }));
  const providerBlocked = providerContract?.status === "blocked"
    || manifest?.status === "blocked"
    || releasePacket?.status === "blocked"
    || providerSummary?.status === "blocked";
  const status = providerBlocked || blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        || providerSummary?.status === "review"
        || manifest?.status === "review"
        ? "review"
        : operationAnchors.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-source-anchor-handoff.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    providerId: mailchimpHandoff.providerId ?? "mailchimp",
    sourceProviderId: providerContract?.providerId ?? providerSummary?.providerId ?? "aios-source-range-provider",
    fileName: options.fileName
      ?? providerContract?.fileName
      ?? persistence?.fileName
      ?? manifest?.fileName
      ?? providerSummary?.fileName
      ?? "inline.aios",
    exportAllowed: status === "ready" || status === "idle" || status === "review",
    restartSafe: !providerBlocked && blocked.length === 0,
    syncKey: [
      mailchimpHandoff.syncMetadata?.serviceSyncKey ?? "mailchimp-service-unbound",
      providerSummary?.syncKey ?? manifest?.syncKey ?? persistence?.syncKey ?? providerContract?.syncMetadata?.syncKey ?? "source-range-unbound",
      options.revision ?? "working",
    ].join("|"),
    operationAnchors: Object.freeze(operationAnchors.sort(compareMailchimpSourceAnchors)),
    orphanAnchors: Object.freeze(orphanAnchors.sort(compareSourceAnchorRows)),
    diagnostics: Object.freeze(diagnostics),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(operationAnchors, "status")),
      byService: freezeSortedRecord(countRangePreviewField(operationAnchors, "service")),
      byAnchorStatus: freezeSortedRecord(countRangePreviewField([...anchorsByJobName.values()], "anchorStatus")),
      byHandoff: freezeSortedRecord(countRangePreviewField(operationAnchors, "handoff")),
    }),
    totals: Object.freeze({
      operationCount: operationAnchors.length,
      anchoredOperationCount: operationAnchors.filter((anchor) => anchor.anchorId).length,
      blockedOperationCount: blocked.length,
      pendingOperationCount: pending.length,
      reviewOperationCount: review.length,
      orphanAnchorCount: orphanAnchors.length,
      diagnosticCount: diagnostics.length,
    }),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: status !== "blocked" && (!requireAcceptance || pending.length === 0),
      requiredAnchorIds: Object.freeze(operationAnchors
        .map((anchor) => anchor.anchorId)
        .filter(Boolean)
        .sort()),
      pendingAnchorIds: Object.freeze(requireAcceptance
        ? pending.map((anchor) => anchor.anchorId).filter(Boolean).sort()
        : []),
      acceptedAnchorIds: Object.freeze(operationAnchors
        .filter((anchor) => anchor.accepted)
        .map((anchor) => anchor.anchorId)
        .filter(Boolean)
        .sort()),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/source-anchor/recovery"
        : status === "pending"
          ? "mailchimp/source-anchor/acceptance"
          : status === "review"
            ? "mailchimp/source-anchor/review"
            : "mailchimp/source-anchor/handoff",
      restartSafe: !providerBlocked && blocked.length === 0,
      blockedOperationIds: Object.freeze(blocked.map((anchor) => anchor.operationId).sort()),
      pendingOperationIds: Object.freeze(pending.map((anchor) => anchor.operationId).sort()),
      reviewOperationIds: Object.freeze(review.map((anchor) => anchor.operationId).sort()),
      idempotencyKeys: Object.freeze(operationAnchors
        .map((anchor) => anchor.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? providerSummary?.handoff?.nextAction
        ?? releasePacket?.restartEnvelope?.nextAction
        ?? "publish-mailchimp-source-anchor-handoff",
    }),
    providerSummary,
  });
}

export function createMailchimpProviderSourceDeploymentPacket(state = {}, options = {}) {
  const sourceAnchorHandoff = state.mailchimpSourceAnchorHandoff ?? state.sourceAnchorHandoff ?? {};
  const providerServiceReadiness = state.mailchimpProviderServiceReadinessMatrix
    ?? state.providerServiceReadiness
    ?? {};
  const providerServiceHandoff = state.mailchimpProviderServiceHandoff ?? state.providerServiceHandoff ?? {};
  const providerServiceExportDeck = state.mailchimpProviderServiceHandoffExportDeck
    ?? state.providerServiceHandoffExportDeck
    ?? null;
  const providerSummary = state.sourceProviderExportSummary ?? state.providerSummary ?? sourceAnchorHandoff.providerSummary ?? null;
  const accepted = normalizeSourceRangeIdSet(options.acceptedMailchimpProviderSourceDeploymentIds);
  const completed = normalizeSourceRangeIdSet(options.completedMailchimpProviderSourceDeploymentIds);
  const failed = normalizeSourceRangeIdSet(options.failedMailchimpProviderSourceDeploymentIds);
  const requireAcceptance = options.requireMailchimpProviderSourceDeploymentAcceptance !== false;
  const sourceRowsByService = groupMailchimpSourceAnchorsByService(sourceAnchorHandoff.operationAnchors);
  const rows = createMailchimpProviderSourceDeploymentRows({
    sourceAnchorHandoff,
    providerServiceReadiness,
    providerServiceHandoff,
    providerServiceExportDeck,
    providerSummary,
    sourceRowsByService,
    accepted,
    completed,
    failed,
    requireAcceptance,
    revision: options.revision ?? "working",
  });
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false || row.exportAllowed === false);
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review" || row.status === "degraded");
  const status = providerServiceHandoff.status === "blocked"
    || providerServiceReadiness.status === "blocked"
    || providerServiceExportDeck?.status === "blocked"
    || sourceAnchorHandoff.status === "blocked"
    || providerSummary?.status === "blocked"
    || blocked.length
    ? "blocked"
    : providerServiceHandoff.status === "pending"
      || providerServiceReadiness.status === "pending"
      || providerServiceExportDeck?.status === "pending"
      || sourceAnchorHandoff.status === "pending"
      || pending.length
      ? "pending"
      : providerServiceHandoff.status === "review"
        || providerServiceReadiness.status === "review"
        || providerServiceReadiness.status === "degraded"
        || providerServiceExportDeck?.status === "review"
        || sourceAnchorHandoff.status === "review"
        || providerSummary?.status === "review"
        || review.length
        ? "review"
        : rows.length
          ? "ready"
          : "idle";
  const exportAllowed = status === "ready"
    || status === "idle"
    || (status === "review" && options.allowReviewMailchimpProviderSourceDeployment === true);

  return Object.freeze({
    version: "mailchimp-provider-source-deployment.v1",
    status,
    ok: status === "ready" || status === "idle" || (status === "review" && exportAllowed),
    exportAllowed,
    providerId: options.providerId ?? sourceAnchorHandoff.providerId ?? "mailchimp",
    sourceProviderId: sourceAnchorHandoff.sourceProviderId ?? providerSummary?.providerId ?? "aios-source-range-provider",
    fileName: options.fileName ?? sourceAnchorHandoff.fileName ?? providerSummary?.fileName ?? "inline.aios",
    revision: options.revision ?? "working",
    syncKey: [
      sourceAnchorHandoff.syncKey ?? "mailchimp-source-anchor-unbound",
      providerServiceHandoff.syncKey ?? "mailchimp-provider-service-unbound",
      providerServiceReadiness.syncKey ?? "mailchimp-provider-readiness-unbound",
      providerServiceExportDeck?.syncKey ?? "mailchimp-provider-export-unbound",
      rows.map((row) => row.idempotencyKey).join(".") || "deployment-empty",
    ].join("|"),
    rows: Object.freeze(rows),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(rows, "status")),
      byService: freezeSortedRecord(countRangePreviewField(rows, "service")),
      byLaneStatus: freezeSortedRecord(countRangePreviewField(rows, "providerLaneStatus")),
      bySourceStatus: freezeSortedRecord(countRangePreviewField(rows, "sourceStatus")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      anchoredOperationCount: rows.reduce((total, row) => total + row.anchoredOperationCount, 0),
      sourceOperationCount: rows.reduce((total, row) => total + row.sourceOperationCount, 0),
      acceptedCount: rows.filter((row) => row.accepted).length,
      completedCount: rows.filter((row) => row.completed).length,
    }),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: status !== "blocked" && (!requireAcceptance || pending.length === 0),
      requiredRowIds: Object.freeze(rows.map((row) => row.id).sort()),
      acceptedRowIds: Object.freeze(rows.filter((row) => row.accepted).map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(requireAcceptance ? pending.map((row) => row.id).sort() : []),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/provider-source-deployment/recovery"
        : status === "pending"
          ? "mailchimp/provider-source-deployment/acceptance"
          : status === "review"
            ? "mailchimp/provider-source-deployment/review"
            : "mailchimp/provider-source-deployment/export",
      restartSafe: blocked.length === 0
        && sourceAnchorHandoff.restartSafe !== false
        && providerServiceHandoff.restartEnvelope?.restartSafe !== false
        && providerServiceExportDeck?.restartEnvelope?.restartSafe !== false,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? sourceAnchorHandoff.restartEnvelope?.nextAction
        ?? providerServiceHandoff.restartEnvelope?.nextAction
        ?? "publish-mailchimp-provider-source-deployment",
    }),
    userVisible: Object.freeze({
      title: "Mailchimp provider source deployment",
      detail: status === "ready" || status === "idle"
        ? "Mailchimp provider service lanes are paired with accepted source anchors for deployment handoff."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review provider-source deployment lane(s) remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-mailchimp-provider-source-deployment",
    }),
    sourceAnchorHandoff,
    providerServiceReadiness,
    providerServiceHandoff,
    providerServiceExportDeck,
  });
}

export function createSourceRangeClientAcceptanceSummary(state = {}, options = {}) {
  const providerContract = state.providerContract ?? state.sourceProvider ?? null;
  const persistence = state.persistence ?? state.sourcePersistence ?? null;
  const manifest = state.manifest ?? state.sourceExportManifest ?? null;
  const releasePacket = state.releasePacket ?? state.sourceReleasePacket ?? null;
  const providerSummary = state.providerSummary ?? state.sourceProviderExportSummary ?? null;
  const mailchimpSourceAnchorHandoff = state.mailchimpSourceAnchorHandoff ?? state.sourceAnchorHandoff ?? null;
  const timeline = state.timeline ?? state.sourceOperationalTimeline ?? null;
  const requireAcceptance = options.requireSourceAnchorAcceptance !== false;
  const sourceRows = createSourceRangeClientSourceRows({
    persistence,
    manifest,
    releasePacket,
    providerSummary,
    requireAcceptance,
  });
  const mailchimpRows = createSourceRangeClientMailchimpRows(mailchimpSourceAnchorHandoff, {
    requireAcceptance,
  });
  const operationRows = createSourceRangeClientOperationRows(timeline, providerSummary);
  const rows = [...sourceRows, ...mailchimpRows, ...operationRows].sort(compareSourceRangeClientRows);
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending" || row.status === "needsAcceptance");
  const review = rows.filter((row) => row.status === "review" || row.status === "changed" || row.status === "degraded");
  const status = providerContract?.status === "blocked"
    || manifest?.status === "blocked"
    || releasePacket?.status === "blocked"
    || providerSummary?.status === "blocked"
    || mailchimpSourceAnchorHandoff?.status === "blocked"
    || blocked.length
    ? "blocked"
    : pending.length
      || persistence?.status === "pending"
      || releasePacket?.status === "pending"
      || mailchimpSourceAnchorHandoff?.status === "pending"
      ? "pending"
      : review.length
        || manifest?.status === "review"
        || providerSummary?.status === "review"
        || mailchimpSourceAnchorHandoff?.status === "review"
        ? "review"
        : rows.length
          || providerContract
          || persistence
          || manifest
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "source-range-client-acceptance-summary.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || status === "idle" || status === "review",
    fileName: options.fileName
      ?? providerContract?.fileName
      ?? persistence?.fileName
      ?? manifest?.fileName
      ?? releasePacket?.fileName
      ?? providerSummary?.fileName
      ?? "inline.aios",
    providerId: options.providerId
      ?? providerContract?.providerId
      ?? persistence?.providerId
      ?? manifest?.providerId
      ?? releasePacket?.providerId
      ?? providerSummary?.providerId
      ?? "aios-source-range-provider",
    syncKey: [
      providerContract?.syncMetadata?.syncKey ?? manifest?.syncKey ?? persistence?.syncKey ?? "source-range",
      releasePacket?.syncKey ?? providerSummary?.syncKey ?? "release-unbound",
      mailchimpSourceAnchorHandoff?.syncKey ?? "mailchimp-source-unbound",
      options.revision ?? "working",
    ].join("|"),
    rows: Object.freeze(rows),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(rows, "status")),
      byKind: freezeSortedRecord(countRangePreviewField(rows, "kind")),
      byRoute: freezeSortedRecord(countRangePreviewField(rows, "route")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      sourceAnchorCount: sourceRows.length,
      mailchimpOperationAnchorCount: mailchimpRows.length,
      operationEventCount: operationRows.length,
    }),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: status !== "blocked" && (!requireAcceptance || pending.length === 0),
      requiredIds: Object.freeze(rows
        .filter((row) => row.acceptanceRequired)
        .map((row) => row.id)
        .sort()),
      acceptedIds: Object.freeze(rows
        .filter((row) => row.accepted)
        .map((row) => row.id)
        .sort()),
      pendingIds: Object.freeze(requireAcceptance ? pending.map((row) => row.id).sort() : []),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "source-ranges/client-acceptance/recovery"
        : status === "pending"
          ? "source-ranges/client-acceptance"
          : status === "review"
            ? "source-ranges/client-review"
            : "source-ranges/client-summary",
      restartSafe: blocked.length === 0,
      blockedIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows
        .map((row) => row.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-source-range-client-acceptance",
    }),
    userVisible: Object.freeze({
      title: "Source range acceptance",
      detail: status === "ready" || status === "idle"
        ? "Source anchors and Mailchimp operation anchors are accepted for client handoff."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review source handoff items remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-source-range-client-acceptance",
    }),
  });
}

export function createSourceRangeClientCommandPacket(state = {}, options = {}) {
  const clientSummary = state.version === "source-range-client-acceptance-summary.v1"
    ? state
    : state.clientSummary?.version === "source-range-client-acceptance-summary.v1"
      ? state.clientSummary
      : createSourceRangeClientAcceptanceSummary(state, options);
  const commandRows = clientSummary.rows.map((row) => createSourceRangeClientCommand(row, {
    clientSummary,
    requireAcceptance: clientSummary.acceptance?.mode !== "implicit",
    requestedCommandIds: options.requestedSourceCommandIds,
    completedCommandIds: options.completedSourceCommandIds,
    failedCommandIds: options.failedSourceCommandIds,
  }));
  const blocked = commandRows.filter((command) => command.status === "blocked");
  const pending = commandRows.filter((command) => command.status === "pending");
  const review = commandRows.filter((command) => command.status === "review");
  const ready = commandRows.filter((command) => command.status === "ready");
  const status = clientSummary.status === "blocked" || blocked.length
    ? "blocked"
    : clientSummary.status === "pending" || pending.length
      ? "pending"
      : clientSummary.status === "review" || review.length
        ? "review"
        : commandRows.length || clientSummary.status === "ready"
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "source-range-client-command-packet.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || status === "idle" || status === "review",
    fileName: clientSummary.fileName,
    providerId: clientSummary.providerId,
    syncKey: [
      clientSummary.syncKey,
      commandRows.map((command) => `${command.id}:${command.status}`).join(",") || "no-source-commands",
      options.revision ?? "working",
    ].join("|"),
    commands: Object.freeze(commandRows.sort(compareSourceRangeClientCommands)),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(commandRows, "status")),
      byKind: freezeSortedRecord(countRangePreviewField(commandRows, "kind")),
      byRoute: freezeSortedRecord(countRangePreviewField(commandRows, "route")),
      byIntent: freezeSortedRecord(countRangePreviewField(commandRows, "intent")),
    }),
    totals: Object.freeze({
      commandCount: commandRows.length,
      readyCommandCount: ready.length,
      blockedCommandCount: blocked.length,
      pendingCommandCount: pending.length,
      reviewCommandCount: review.length,
      acceptanceRequiredCount: commandRows.filter((command) => command.acceptanceRequired).length,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "source-ranges/client-commands/recovery"
        : status === "pending"
          ? "source-ranges/client-commands/acceptance"
          : status === "review"
            ? "source-ranges/client-commands/review"
            : "source-ranges/client-commands/summary",
      restartSafe: blocked.length === 0 && clientSummary.restartEnvelope.restartSafe,
      blockedCommandIds: Object.freeze(blocked.map((command) => command.id).sort()),
      pendingCommandIds: Object.freeze(pending.map((command) => command.id).sort()),
      reviewCommandIds: Object.freeze(review.map((command) => command.id).sort()),
      idempotencyKeys: Object.freeze(commandRows
        .map((command) => command.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? clientSummary.restartEnvelope.nextAction,
    }),
    userVisible: Object.freeze({
      title: "Source range client commands",
      detail: status === "ready" || status === "idle"
        ? "Source range client commands are restart-safe for handoff."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review source commands remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? clientSummary.userVisible.nextAction,
    }),
    clientSummary,
  });
}

export function createSourceRangeClientActionDeck(state = {}, options = {}) {
  const clientSummary = state.clientSummary?.version === "source-range-client-acceptance-summary.v1"
    ? state.clientSummary
    : state.sourceClientAcceptanceSummary?.version === "source-range-client-acceptance-summary.v1"
      ? state.sourceClientAcceptanceSummary
      : createSourceRangeClientAcceptanceSummary(state, options);
  const commandPacket = state.commandPacket?.version === "source-range-client-command-packet.v1"
    ? state.commandPacket
    : state.sourceRangeClientCommandPacket?.version === "source-range-client-command-packet.v1"
      ? state.sourceRangeClientCommandPacket
      : createSourceRangeClientCommandPacket(clientSummary, options);
  const releasePacket = state.releasePacket ?? state.sourceReleasePacket ?? null;
  const providerSummary = state.providerSummary ?? state.sourceProviderExportSummary ?? null;
  const rows = [
    ...createSourceRangeDeckRowsFromAcceptance(clientSummary),
    ...createSourceRangeDeckRowsFromCommands(commandPacket),
    ...createSourceRangeDeckRowsFromProvider(providerSummary),
    ...createSourceRangeDeckRowsFromRelease(releasePacket),
  ].sort(compareSourceRangeActionDeckRows);
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending" || row.status === "needsAcceptance");
  const review = rows.filter((row) => row.status === "review" || row.status === "changed" || row.status === "degraded");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : rows.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "source-range-client-action-deck.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || status === "idle" || status === "review",
    fileName: clientSummary.fileName,
    providerId: clientSummary.providerId,
    syncKey: [
      clientSummary.syncKey,
      commandPacket.syncKey,
      providerSummary?.syncKey ?? "provider-summary-unbound",
      options.revision ?? "working",
    ].join("|"),
    rows: Object.freeze(rows),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(rows, "status")),
      byKind: freezeSortedRecord(countRangePreviewField(rows, "kind")),
      byRoute: freezeSortedRecord(countRangePreviewField(rows, "route")),
      bySource: freezeSortedRecord(countRangePreviewField(rows, "source")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      acceptanceRowCount: rows.filter((row) => row.source === "acceptance").length,
      commandRowCount: rows.filter((row) => row.source === "command").length,
      providerRowCount: rows.filter((row) => row.source === "provider").length,
      releaseRowCount: rows.filter((row) => row.source === "release").length,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "source-ranges/client-actions/recovery"
        : status === "pending"
          ? "source-ranges/client-actions/acceptance"
          : status === "review"
            ? "source-ranges/client-actions/review"
            : "source-ranges/client-actions/summary",
      restartSafe: blocked.length === 0 && commandPacket.restartEnvelope.restartSafe,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? commandPacket.restartEnvelope.nextAction
        ?? clientSummary.restartEnvelope.nextAction,
    }),
    userVisible: Object.freeze({
      title: "Source range client actions",
      detail: status === "ready" || status === "idle"
        ? "Source range preview, acceptance, and client commands are ready."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review source actions remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? commandPacket.userVisible.nextAction,
    }),
    clientSummary,
    commandPacket,
  });
}

export function createSourceRangeRuntimeResumePacket(state = {}, options = {}) {
  const clientSummary = state.clientSummary?.version === "source-range-client-acceptance-summary.v1"
    ? state.clientSummary
    : state.sourceClientAcceptanceSummary?.version === "source-range-client-acceptance-summary.v1"
      ? state.sourceClientAcceptanceSummary
      : createSourceRangeClientAcceptanceSummary(state, options);
  const commandPacket = state.commandPacket?.version === "source-range-client-command-packet.v1"
    ? state.commandPacket
    : state.sourceRangeClientCommandPacket?.version === "source-range-client-command-packet.v1"
      ? state.sourceRangeClientCommandPacket
      : createSourceRangeClientCommandPacket(clientSummary, options);
  const actionDeck = state.actionDeck?.version === "source-range-client-action-deck.v1"
    ? state.actionDeck
    : state.sourceRangeClientActionDeck?.version === "source-range-client-action-deck.v1"
      ? state.sourceRangeClientActionDeck
      : createSourceRangeClientActionDeck({
          ...state,
          clientSummary,
          commandPacket,
        }, options);
  const boundaryAudit = state.boundaryAudit ?? state.sourceBoundaryAudit ?? null;
  const providerSummary = state.providerSummary ?? state.sourceProviderExportSummary ?? null;
  const rows = [
    ...createSourceRangeResumeRowsFromClientSummary(clientSummary),
    ...createSourceRangeResumeRowsFromCommandPacket(commandPacket),
    ...createSourceRangeResumeRowsFromActionDeck(actionDeck),
    ...createSourceRangeResumeRowsFromBoundaryAudit(boundaryAudit),
    ...createSourceRangeResumeRowsFromProviderSummary(providerSummary),
  ].sort(compareSourceRangeResumeRows);
  const dedupedRows = dedupeSourceRangeResumeRows(rows);
  const blocked = dedupedRows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = dedupedRows.filter((row) => row.status === "pending");
  const review = dedupedRows.filter((row) => row.status === "review");
  const status = clientSummary.status === "blocked"
    || commandPacket.status === "blocked"
    || actionDeck.status === "blocked"
    || boundaryAudit?.status === "blocked"
    || providerSummary?.status === "blocked"
    || blocked.length
    ? "blocked"
    : clientSummary.status === "pending"
      || commandPacket.status === "pending"
      || actionDeck.status === "pending"
      || boundaryAudit?.status === "pending"
      || pending.length
      ? "pending"
      : clientSummary.status === "review"
        || commandPacket.status === "review"
        || actionDeck.status === "review"
        || boundaryAudit?.status === "review"
        || providerSummary?.status === "review"
        || review.length
        ? "review"
        : dedupedRows.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "source-range-runtime-resume-packet.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || status === "idle" || status === "review",
    fileName: options.fileName ?? clientSummary.fileName ?? "inline.aios",
    providerId: options.providerId ?? clientSummary.providerId ?? "aios-source-range-provider",
    revision: options.revision ?? "working",
    syncKey: [
      clientSummary.syncKey,
      commandPacket.syncKey,
      actionDeck.syncKey,
      boundaryAudit?.syncKey ?? "source-boundary-unbound",
      providerSummary?.syncKey ?? "source-provider-unbound",
      options.revision ?? "working",
    ].join("|"),
    rows: Object.freeze(dedupedRows),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(dedupedRows, "status")),
      byKind: freezeSortedRecord(countRangePreviewField(dedupedRows, "kind")),
      byRoute: freezeSortedRecord(countRangePreviewField(dedupedRows, "route")),
      byOrigin: freezeSortedRecord(countRangePreviewField(dedupedRows, "origin")),
    }),
    totals: Object.freeze({
      rowCount: dedupedRows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      acceptanceCount: clientSummary.totals?.rowCount ?? 0,
      commandCount: commandPacket.totals?.commandCount ?? 0,
      actionCount: actionDeck.totals?.rowCount ?? 0,
      boundaryEventCount: boundaryAudit?.auditEvents?.length ?? 0,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "source-ranges/runtime-resume/recovery"
        : status === "pending"
          ? "source-ranges/runtime-resume/acceptance"
          : status === "review"
            ? "source-ranges/runtime-resume/review"
            : "source-ranges/runtime-resume/summary",
      restartSafe: blocked.length === 0
        && clientSummary.restartEnvelope.restartSafe
        && commandPacket.restartEnvelope.restartSafe
        && actionDeck.restartEnvelope.restartSafe
        && boundaryAudit?.restartEnvelope?.restartSafe !== false,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(dedupedRows
        .map((row) => row.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? actionDeck.restartEnvelope.nextAction
        ?? commandPacket.restartEnvelope.nextAction
        ?? clientSummary.restartEnvelope.nextAction,
    }),
    userVisible: Object.freeze({
      title: "Source range runtime resume",
      detail: status === "ready" || status === "idle"
        ? "Source previews, commands, and boundary checks are restart-safe for runtime resume."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review source resume rows remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? actionDeck.userVisible.nextAction,
    }),
    clientSummary,
    commandPacket,
    actionDeck,
    boundaryAudit,
    providerSummary,
  });
}

export function createSourceRangeClientWorkflowHandoffQueue(state = {}, options = {}) {
  const clientSummary = state.clientSummary?.version === "source-range-client-acceptance-summary.v1"
    ? state.clientSummary
    : state.sourceClientAcceptanceSummary?.version === "source-range-client-acceptance-summary.v1"
      ? state.sourceClientAcceptanceSummary
      : createSourceRangeClientAcceptanceSummary(state, options);
  const commandPacket = state.commandPacket?.version === "source-range-client-command-packet.v1"
    ? state.commandPacket
    : state.sourceRangeClientCommandPacket?.version === "source-range-client-command-packet.v1"
      ? state.sourceRangeClientCommandPacket
      : createSourceRangeClientCommandPacket(clientSummary, options);
  const actionDeck = state.actionDeck?.version === "source-range-client-action-deck.v1"
    ? state.actionDeck
    : state.sourceRangeClientActionDeck?.version === "source-range-client-action-deck.v1"
      ? state.sourceRangeClientActionDeck
      : createSourceRangeClientActionDeck({
          ...state,
          clientSummary,
          commandPacket,
        }, options);
  const runtimeResume = state.runtimeResume?.version === "source-range-runtime-resume-packet.v1"
    ? state.runtimeResume
    : state.sourceRuntimeResumePacket?.version === "source-range-runtime-resume-packet.v1"
      ? state.sourceRuntimeResumePacket
      : createSourceRangeRuntimeResumePacket({
          ...state,
          clientSummary,
          commandPacket,
          actionDeck,
        }, options);
  const acceptedQueueIds = normalizeSourceRangeHandoffIdSet(options.acceptedSourceWorkflowQueueIds);
  const completedQueueIds = normalizeSourceRangeHandoffIdSet(options.completedSourceWorkflowQueueIds);
  const failedQueueIds = normalizeSourceRangeHandoffIdSet(options.failedSourceWorkflowQueueIds);
  const retryQueueIds = normalizeSourceRangeHandoffIdSet(options.retrySourceWorkflowQueueIds);
  const queueRows = [
    ...createSourceRangeWorkflowRowsFromClientSummary(clientSummary),
    ...createSourceRangeWorkflowRowsFromCommandPacket(commandPacket),
    ...createSourceRangeWorkflowRowsFromActionDeck(actionDeck),
    ...createSourceRangeWorkflowRowsFromRuntimeResume(runtimeResume),
  ].map((row) => applySourceRangeWorkflowQueueProgress(row, {
    acceptedQueueIds,
    completedQueueIds,
    failedQueueIds,
    retryQueueIds,
    requireAcceptance: options.requireSourceWorkflowQueueAcceptance,
  }));
  const rows = dedupeSourceRangeWorkflowQueueRows(queueRows);
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending" || row.status === "needsAcceptance");
  const review = rows.filter((row) => row.status === "review" || row.status === "degraded");
  const status = clientSummary.status === "blocked"
    || commandPacket.status === "blocked"
    || actionDeck.status === "blocked"
    || runtimeResume.status === "blocked"
    || blocked.length
    ? "blocked"
    : clientSummary.status === "pending"
      || commandPacket.status === "pending"
      || actionDeck.status === "pending"
      || runtimeResume.status === "pending"
      || pending.length
      ? "pending"
      : clientSummary.status === "review"
        || commandPacket.status === "review"
        || actionDeck.status === "review"
        || runtimeResume.status === "review"
        || review.length
        ? "review"
        : rows.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "source-range-client-workflow-handoff-queue.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || status === "idle" || status === "review",
    fileName: options.fileName ?? clientSummary.fileName ?? runtimeResume.fileName ?? "inline.aios",
    providerId: options.providerId ?? clientSummary.providerId ?? runtimeResume.providerId ?? "aios-source-range-provider",
    revision: options.revision ?? runtimeResume.revision ?? "working",
    syncKey: [
      clientSummary.syncKey,
      commandPacket.syncKey,
      actionDeck.syncKey,
      runtimeResume.syncKey,
      rows.map((row) => `${row.id}:${row.status}`).join(",") || "source-workflow-queue-empty",
      options.revision ?? "working",
    ].join("|"),
    rows: Object.freeze(rows),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(rows, "status")),
      byOrigin: freezeSortedRecord(countRangePreviewField(rows, "origin")),
      byIntent: freezeSortedRecord(countRangePreviewField(rows, "intent")),
      byRoute: freezeSortedRecord(countRangePreviewField(rows, "route")),
      byAcceptance: freezeSortedRecord(countRangePreviewField(rows, "acceptanceState")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      acceptedCount: rows.filter((row) => row.acceptanceState === "accepted").length,
      completedCount: rows.filter((row) => row.completed).length,
      retryCount: rows.filter((row) => row.retryRequested).length,
      clientSummaryRowCount: clientSummary.totals?.rowCount ?? 0,
      commandCount: commandPacket.totals?.commandCount ?? 0,
      actionCount: actionDeck.totals?.rowCount ?? 0,
      resumeCount: runtimeResume.totals?.rowCount ?? 0,
    }),
    acceptance: Object.freeze({
      mode: options.requireSourceWorkflowQueueAcceptance === false ? "implicit" : "explicit",
      acceptable: status !== "blocked" && (options.requireSourceWorkflowQueueAcceptance === false || pending.length === 0),
      requiredQueueIds: Object.freeze(rows.filter((row) => row.acceptanceRequired).map((row) => row.id).sort()),
      acceptedQueueIds: Object.freeze([...acceptedQueueIds].sort()),
      pendingQueueIds: Object.freeze(options.requireSourceWorkflowQueueAcceptance === false ? [] : pending.map((row) => row.id).sort()),
      completedQueueIds: Object.freeze([...completedQueueIds].sort()),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "source-ranges/client-workflow/recovery"
        : status === "pending"
          ? "source-ranges/client-workflow/acceptance"
          : status === "review"
            ? "source-ranges/client-workflow/review"
            : "source-ranges/client-workflow/handoff",
      restartSafe: blocked.length === 0
        && clientSummary.restartEnvelope.restartSafe
        && commandPacket.restartEnvelope.restartSafe
        && actionDeck.restartEnvelope.restartSafe
        && runtimeResume.restartEnvelope.restartSafe,
      blockedQueueIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingQueueIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewQueueIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? runtimeResume.restartEnvelope.nextAction
        ?? actionDeck.restartEnvelope.nextAction,
    }),
    userVisible: Object.freeze({
      title: "Source workflow handoff queue",
      detail: status === "ready" || status === "idle"
        ? "Source acceptance, command, action, and resume rows are queued for client workflow handoff."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review source workflow queue rows remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? runtimeResume.userVisible.nextAction,
    }),
    clientSummary,
    commandPacket,
    actionDeck,
    runtimeResume,
  });
}

export function createSourceRangeClientRouteHandoffPacket(state = {}, options = {}) {
  const clientSummary = state.clientSummary?.version === "source-range-client-acceptance-summary.v1"
    ? state.clientSummary
    : state.sourceClientAcceptanceSummary?.version === "source-range-client-acceptance-summary.v1"
      ? state.sourceClientAcceptanceSummary
      : createSourceRangeClientAcceptanceSummary(state, options);
  const commandPacket = state.commandPacket?.version === "source-range-client-command-packet.v1"
    ? state.commandPacket
    : state.sourceRangeClientCommandPacket?.version === "source-range-client-command-packet.v1"
      ? state.sourceRangeClientCommandPacket
      : createSourceRangeClientCommandPacket(clientSummary, options);
  const actionDeck = state.actionDeck?.version === "source-range-client-action-deck.v1"
    ? state.actionDeck
    : state.sourceRangeClientActionDeck?.version === "source-range-client-action-deck.v1"
      ? state.sourceRangeClientActionDeck
      : createSourceRangeClientActionDeck({
          ...state,
          clientSummary,
          commandPacket,
        }, options);
  const runtimeResume = state.runtimeResume?.version === "source-range-runtime-resume-packet.v1"
    ? state.runtimeResume
    : state.sourceRuntimeResumePacket?.version === "source-range-runtime-resume-packet.v1"
      ? state.sourceRuntimeResumePacket
      : createSourceRangeRuntimeResumePacket({
          ...state,
          clientSummary,
          commandPacket,
          actionDeck,
        }, options);
  const workflowQueue = state.workflowQueue?.version === "source-range-client-workflow-handoff-queue.v1"
    ? state.workflowQueue
    : state.sourceClientWorkflowHandoffQueue?.version === "source-range-client-workflow-handoff-queue.v1"
      ? state.sourceClientWorkflowHandoffQueue
      : createSourceRangeClientWorkflowHandoffQueue({
          ...state,
          clientSummary,
          commandPacket,
          actionDeck,
          runtimeResume,
        }, options);
  const acceptedRouteIds = normalizeSourceRangeHandoffIdSet(options.acceptedSourceClientRouteIds);
  const completedRouteIds = normalizeSourceRangeHandoffIdSet(options.completedSourceClientRouteIds);
  const failedRouteIds = normalizeSourceRangeHandoffIdSet(options.failedSourceClientRouteIds);
  const routeRows = dedupeSourceRangeClientRouteRows([
    ...createSourceRangeClientRoutesFromSummary(clientSummary),
    ...createSourceRangeClientRoutesFromCommands(commandPacket),
    ...createSourceRangeClientRoutesFromActions(actionDeck),
    ...createSourceRangeClientRoutesFromRuntimeResume(runtimeResume),
    ...createSourceRangeClientRoutesFromWorkflowQueue(workflowQueue),
  ].map((route) => applySourceRangeClientRouteProgress(route, {
    acceptedRouteIds,
    completedRouteIds,
    failedRouteIds,
    requireAcceptance: options.requireSourceClientRouteAcceptance,
  })));
  const blocked = routeRows.filter((route) => route.status === "blocked" || route.restartSafe === false || route.exportAllowed === false);
  const pending = routeRows.filter((route) => route.status === "pending" || route.status === "needsAcceptance");
  const review = routeRows.filter((route) => route.status === "review" || route.status === "degraded");
  const status = clientSummary.status === "blocked"
    || commandPacket.status === "blocked"
    || actionDeck.status === "blocked"
    || runtimeResume.status === "blocked"
    || workflowQueue.status === "blocked"
    || blocked.length
    ? "blocked"
    : clientSummary.status === "pending"
      || commandPacket.status === "pending"
      || actionDeck.status === "pending"
      || runtimeResume.status === "pending"
      || workflowQueue.status === "pending"
      || pending.length
      ? "pending"
      : clientSummary.status === "review"
        || commandPacket.status === "review"
        || actionDeck.status === "review"
        || runtimeResume.status === "review"
        || workflowQueue.status === "review"
        || review.length
        ? "review"
        : routeRows.length
          ? "ready"
          : "idle";
  const restartSafe = blocked.length === 0
    && clientSummary.restartEnvelope.restartSafe
    && commandPacket.restartEnvelope.restartSafe
    && actionDeck.restartEnvelope.restartSafe
    && runtimeResume.restartEnvelope.restartSafe
    && workflowQueue.restartEnvelope.restartSafe;

  return Object.freeze({
    version: "source-range-client-route-handoff.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || status === "idle" || (status === "review" && options.allowReviewSourceClientRouteHandoff === true),
    restartSafe,
    fileName: options.fileName ?? clientSummary.fileName ?? runtimeResume.fileName ?? "inline.aios",
    providerId: options.providerId ?? clientSummary.providerId ?? runtimeResume.providerId ?? "aios-source-range-provider",
    revision: options.revision ?? runtimeResume.revision ?? "working",
    syncKey: [
      clientSummary.syncKey,
      commandPacket.syncKey,
      actionDeck.syncKey,
      runtimeResume.syncKey,
      workflowQueue.syncKey,
      routeRows.map((route) => `${route.id}:${route.status}`).join(",") || "source-route-handoff-empty",
      options.revision ?? "working",
    ].join("|"),
    routes: Object.freeze(routeRows),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(routeRows, "status")),
      byKind: freezeSortedRecord(countRangePreviewField(routeRows, "kind")),
      byRoute: freezeSortedRecord(countRangePreviewField(routeRows, "route")),
      byOrigin: freezeSortedRecord(countRangePreviewField(routeRows, "origin")),
      byAcceptance: freezeSortedRecord(countRangePreviewField(routeRows, "acceptanceState")),
    }),
    totals: Object.freeze({
      routeCount: routeRows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      acceptedCount: routeRows.filter((route) => route.acceptanceState === "accepted").length,
      completedCount: routeRows.filter((route) => route.completed).length,
      clientSummaryRowCount: clientSummary.totals?.rowCount ?? 0,
      commandCount: commandPacket.totals?.commandCount ?? 0,
      actionCount: actionDeck.totals?.rowCount ?? 0,
      resumeCount: runtimeResume.totals?.rowCount ?? 0,
      workflowQueueCount: workflowQueue.totals?.rowCount ?? 0,
    }),
    acceptance: Object.freeze({
      mode: options.requireSourceClientRouteAcceptance === false ? "implicit" : "explicit",
      acceptable: status !== "blocked" && (options.requireSourceClientRouteAcceptance === false || pending.length === 0),
      requiredRouteIds: Object.freeze(routeRows.filter((route) => route.acceptanceRequired).map((route) => route.id).sort()),
      acceptedRouteIds: Object.freeze([...acceptedRouteIds].sort()),
      pendingRouteIds: Object.freeze(options.requireSourceClientRouteAcceptance === false ? [] : pending.map((route) => route.id).sort()),
      completedRouteIds: Object.freeze([...completedRouteIds].sort()),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "source-ranges/client-route-handoff/recovery"
        : status === "pending"
          ? "source-ranges/client-route-handoff/acceptance"
          : status === "review"
            ? "source-ranges/client-route-handoff/review"
            : "source-ranges/client-route-handoff/summary",
      restartSafe,
      blockedRouteIds: Object.freeze(blocked.map((route) => route.id).sort()),
      pendingRouteIds: Object.freeze(pending.map((route) => route.id).sort()),
      reviewRouteIds: Object.freeze(review.map((route) => route.id).sort()),
      idempotencyKeys: Object.freeze(routeRows.map((route) => route.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? workflowQueue.restartEnvelope.nextAction
        ?? runtimeResume.restartEnvelope.nextAction,
    }),
    userVisible: Object.freeze({
      title: "Source range client route handoff",
      detail: status === "ready" || status === "idle"
        ? "Source preview routes, commands, resume rows, and workflow queue rows are ready for client handoff."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review client route handoff rows remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? workflowQueue.userVisible.nextAction,
    }),
    clientSummary,
    commandPacket,
    actionDeck,
    runtimeResume,
    workflowQueue,
  });
}

export function createMailchimpPreviewActionStrip(state = {}, options = {}) {
  const routePacket = state.routePacket?.version === "source-range-client-route-handoff.v1"
    ? state.routePacket
    : state.sourceClientRouteHandoffPacket?.version === "source-range-client-route-handoff.v1"
      ? state.sourceClientRouteHandoffPacket
      : createSourceRangeClientRouteHandoffPacket(state, options);
  const actionDeck = state.actionDeck?.version === "source-range-client-action-deck.v1"
    ? state.actionDeck
    : state.sourceRangeClientActionDeck?.version === "source-range-client-action-deck.v1"
      ? state.sourceRangeClientActionDeck
      : null;
  const workflowQueue = state.workflowQueue?.version === "source-range-client-workflow-handoff-queue.v1"
    ? state.workflowQueue
    : state.sourceClientWorkflowHandoffQueue?.version === "source-range-client-workflow-handoff-queue.v1"
      ? state.sourceClientWorkflowHandoffQueue
      : null;
  const accepted = normalizeSourceRangeHandoffIdSet(options.acceptedMailchimpPreviewActionIds);
  const completed = normalizeSourceRangeHandoffIdSet(options.completedMailchimpPreviewActionIds);
  const failed = normalizeSourceRangeHandoffIdSet(options.failedMailchimpPreviewActionIds);
  const rows = dedupeMailchimpPreviewActions([
    ...createMailchimpPreviewActionsFromRoutes(routePacket),
    ...createMailchimpPreviewActionsFromActionDeck(actionDeck),
    ...createMailchimpPreviewActionsFromWorkflowQueue(workflowQueue),
    ...createMailchimpPreviewActionsFromLifecycle(options.mailchimpLifecycleCommandState),
    ...createMailchimpPreviewActionsFromControlPlane(options.mailchimpCampaignControlPlane),
  ].map((action) => finalizeMailchimpPreviewAction(action, {
    accepted,
    completed,
    failed,
    requireAcceptance: options.requireMailchimpPreviewActionAcceptance !== false,
    fileName: options.fileName ?? routePacket.fileName ?? "inline.aios",
    revision: options.revision ?? routePacket.revision ?? "working",
  })));
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review");
  const status = routePacket.status === "blocked" || blocked.length
    ? "blocked"
    : routePacket.status === "pending" || pending.length
      ? "pending"
      : routePacket.status === "review" || review.length
        ? "review"
        : rows.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-preview-action-strip.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready"
      || status === "idle"
      || (status === "review" && options.allowReviewMailchimpPreviewActionStrip === true),
    restartSafe: routePacket.restartSafe !== false && blocked.length === 0,
    fileName: options.fileName ?? routePacket.fileName ?? "inline.aios",
    providerId: options.providerId ?? routePacket.providerId ?? "mailchimp",
    revision: options.revision ?? routePacket.revision ?? "working",
    syncKey: [
      routePacket.syncKey,
      rows.map((row) => `${row.id}:${row.status}:${row.acceptanceState}`).join(",") || "mailchimp-preview-actions-empty",
      options.revision ?? routePacket.revision ?? "working",
    ].join("|"),
    actions: Object.freeze(rows),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(rows, "status")),
      byKind: freezeSortedRecord(countRangePreviewField(rows, "kind")),
      byRoute: freezeSortedRecord(countRangePreviewField(rows, "route")),
      byAcceptance: freezeSortedRecord(countRangePreviewField(rows, "acceptanceState")),
    }),
    totals: Object.freeze({
      actionCount: rows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      acceptedCount: rows.filter((row) => row.accepted).length,
      completedCount: rows.filter((row) => row.completed).length,
    }),
    acceptance: Object.freeze({
      mode: options.requireMailchimpPreviewActionAcceptance === false ? "implicit" : "explicit",
      acceptable: status !== "blocked"
        && (options.requireMailchimpPreviewActionAcceptance === false || pending.length === 0),
      requiredActionIds: Object.freeze(rows.map((row) => row.id).sort()),
      acceptedActionIds: Object.freeze(rows.filter((row) => row.accepted).map((row) => row.id).sort()),
      pendingActionIds: Object.freeze(options.requireMailchimpPreviewActionAcceptance === false
        ? []
        : pending.map((row) => row.id).sort()),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/preview-actions/recovery"
        : status === "pending"
          ? "mailchimp/preview-actions/acceptance"
          : status === "review"
            ? "mailchimp/preview-actions/review"
            : "mailchimp/preview-actions/summary",
      restartSafe: routePacket.restartSafe !== false && blocked.length === 0,
      blockedActionIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingActionIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewActionIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? routePacket.restartEnvelope?.nextAction
        ?? "publish-mailchimp-preview-action-strip",
    }),
    routePacket,
  });
}

function createMailchimpPreviewActionsFromRoutes(routePacket = {}) {
  return (Array.isArray(routePacket?.routes) ? routePacket.routes : [])
    .filter((route) => route.origin === "mailchimp" || String(route.handoff ?? route.route ?? "").includes("mailchimp"))
    .map((route) => mailchimpPreviewActionRow({
      id: `preview-route:${route.id}`,
      sourceId: route.id,
      kind: "clientRoute",
      status: normalizeMailchimpPreviewActionStatus(route.status),
      route: route.route ?? "mailchimp/preview",
      targetId: route.targetId ?? null,
      jobName: inferMailchimpPreviewJobName(route),
      sourceAnchorId: route.sourceAnchorId ?? route.targetId ?? null,
      label: route.userVisible?.label ?? route.label ?? route.id,
      detail: route.userVisible?.detail ?? route.detail ?? "Mailchimp preview route is ready for client handoff.",
      accepted: route.accepted === true,
      restartSafe: route.restartSafe !== false && route.exportAllowed !== false,
      idempotencyKey: route.idempotencyKey ?? route.syncKey ?? null,
      nextAction: route.nextAction ?? "open-mailchimp-preview-route",
    }));
}

function createMailchimpPreviewActionsFromActionDeck(actionDeck = {}) {
  const rows = Array.isArray(actionDeck?.actions)
    ? actionDeck.actions
    : Array.isArray(actionDeck?.rows)
      ? actionDeck.rows
      : [];
  return rows
    .filter((action) => action.origin === "mailchimp" || String(action.handoff ?? action.route ?? "").includes("mailchimp"))
    .map((action) => mailchimpPreviewActionRow({
      id: `preview-action:${action.id}`,
      sourceId: action.id,
      kind: action.kind ?? "sourceAction",
      status: normalizeMailchimpPreviewActionStatus(action.status),
      route: action.route ?? "mailchimp/preview-actions",
      targetId: action.targetId ?? action.target ?? null,
      jobName: inferMailchimpPreviewJobName(action),
      sourceAnchorId: action.sourceAnchorId ?? action.targetId ?? null,
      label: action.userVisible?.label ?? action.label ?? action.id,
      detail: action.userVisible?.detail ?? action.detail ?? "Mailchimp source action is ready for preview.",
      accepted: action.accepted === true,
      restartSafe: action.restartSafe !== false,
      idempotencyKey: action.idempotencyKey ?? null,
      nextAction: action.nextAction ?? "run-mailchimp-preview-action",
    }));
}

function createMailchimpPreviewActionsFromWorkflowQueue(workflowQueue = {}) {
  return (Array.isArray(workflowQueue?.rows) ? workflowQueue.rows : [])
    .filter((row) => row.origin === "mailchimp" || String(row.handoff ?? row.route ?? "").includes("mailchimp"))
    .map((row) => mailchimpPreviewActionRow({
      id: `preview-workflow:${row.id}`,
      sourceId: row.id,
      kind: row.kind ?? "workflowQueue",
      status: normalizeMailchimpPreviewActionStatus(row.status),
      route: row.route ?? "mailchimp/workflow-handoff",
      targetId: row.targetId ?? row.target ?? null,
      jobName: inferMailchimpPreviewJobName(row),
      sourceAnchorId: row.sourceAnchorId ?? row.targetId ?? null,
      label: row.userVisible?.label ?? row.label ?? row.id,
      detail: row.userVisible?.detail ?? row.detail ?? "Mailchimp workflow handoff row is ready for preview.",
      accepted: row.accepted === true,
      restartSafe: row.restartSafe !== false,
      idempotencyKey: row.idempotencyKey ?? null,
      nextAction: row.nextAction ?? "settle-mailchimp-workflow-preview",
    }));
}

function createMailchimpPreviewActionsFromLifecycle(lifecycleState = {}) {
  return (Array.isArray(lifecycleState?.rows) ? lifecycleState.rows : [])
    .filter((row) => row.status !== "ready" || row.commandId)
    .map((row) => mailchimpPreviewActionRow({
      id: `preview-lifecycle:${row.id ?? row.commandId}`,
      sourceId: row.id ?? row.commandId,
      kind: "lifecycleCommand",
      status: normalizeMailchimpPreviewActionStatus(row.status),
      route: "mailchimp/lifecycle",
      targetId: row.commandId ?? row.id ?? null,
      jobName: row.jobName ?? null,
      sourceAnchorId: null,
      label: row.label ?? row.commandId ?? row.id,
      detail: row.reason ?? row.detail ?? "Mailchimp lifecycle command is part of preview handoff.",
      accepted: row.accepted === true || row.completed === true,
      restartSafe: row.restartSafe !== false,
      idempotencyKey: row.idempotencyKey ?? null,
      nextAction: row.nextAction ?? "settle-mailchimp-lifecycle-command",
    }));
}

function createMailchimpPreviewActionsFromControlPlane(controlPlane = {}) {
  return (Array.isArray(controlPlane?.rows) ? controlPlane.rows : [])
    .map((row) => mailchimpPreviewActionRow({
      id: `preview-control-plane:${row.id}`,
      sourceId: row.id,
      kind: row.kind ?? "controlPlane",
      status: normalizeMailchimpPreviewActionStatus(row.status),
      route: row.route ?? "mailchimp/control-plane",
      targetId: row.targetId ?? row.id,
      jobName: row.jobName ?? inferMailchimpPreviewJobName(row),
      sourceAnchorId: null,
      label: row.label ?? row.id,
      detail: row.detail ?? "Mailchimp control-plane row is ready for preview handoff.",
      accepted: row.accepted === true,
      restartSafe: row.restartSafe !== false,
      idempotencyKey: row.idempotencyKey ?? null,
      nextAction: row.nextAction ?? "review-mailchimp-control-plane",
    }));
}

function mailchimpPreviewActionRow(action) {
  return Object.freeze({
    id: String(action.id),
    sourceId: action.sourceId ? String(action.sourceId) : null,
    kind: String(action.kind ?? "mailchimpPreviewAction"),
    status: normalizeMailchimpPreviewActionStatus(action.status),
    route: action.route ?? "mailchimp/preview",
    targetId: action.targetId ? String(action.targetId) : null,
    jobName: action.jobName ? String(action.jobName) : null,
    sourceAnchorId: action.sourceAnchorId ? String(action.sourceAnchorId) : null,
    label: String(action.label ?? action.id),
    detail: String(action.detail ?? ""),
    accepted: action.accepted === true,
    completed: action.completed === true,
    failed: action.failed === true,
    restartSafe: action.restartSafe !== false,
    idempotencyKey: action.idempotencyKey ? String(action.idempotencyKey) : null,
    nextAction: action.nextAction ?? "review-mailchimp-preview-action",
    userVisible: Object.freeze({
      label: String(action.label ?? action.id),
      detail: String(action.detail ?? ""),
      nextAction: action.nextAction ?? "review-mailchimp-preview-action",
    }),
  });
}

function finalizeMailchimpPreviewAction(action, context) {
  const completed = context.completed.has(action.id) || action.completed;
  const failed = context.failed.has(action.id) || action.failed;
  const accepted = context.accepted.has(action.id) || action.accepted || context.requireAcceptance === false;
  const blocked = failed || action.status === "blocked" || action.restartSafe === false;
  const status = blocked
    ? "blocked"
    : completed
      ? "ready"
      : context.requireAcceptance && !accepted
        ? "pending"
        : action.status === "pending"
          ? "pending"
          : action.status === "review"
            ? "review"
            : "ready";
  const nextAction = blocked
    ? action.nextAction ?? "repair-mailchimp-preview-action"
    : completed
      ? "retain-mailchimp-preview-action"
      : context.requireAcceptance && !accepted
        ? "accept-mailchimp-preview-action"
        : action.nextAction ?? "publish-mailchimp-preview-action";

  return Object.freeze({
    ...action,
    status,
    accepted,
    completed,
    failed,
    acceptanceState: accepted ? "accepted" : context.requireAcceptance ? "pending" : "implicit",
    restartSafe: action.restartSafe !== false && !failed,
    idempotencyKey: action.idempotencyKey ?? [
      context.fileName,
      context.revision,
      action.id,
      action.route,
      action.targetId ?? "target-unbound",
    ].join(":"),
    nextAction,
    userVisible: Object.freeze({
      ...action.userVisible,
      nextAction,
    }),
  });
}

function dedupeMailchimpPreviewActions(actions = []) {
  const rows = new Map();
  for (const action of actions) {
    const existing = rows.get(action.id);
    if (!existing || mailchimpPreviewActionStatusOrder(action.status) < mailchimpPreviewActionStatusOrder(existing.status)) {
      rows.set(action.id, action);
    }
  }
  return [...rows.values()]
    .sort((left, right) => mailchimpPreviewActionStatusOrder(left.status) - mailchimpPreviewActionStatusOrder(right.status)
      || left.kind.localeCompare(right.kind)
      || left.id.localeCompare(right.id));
}

function normalizeMailchimpPreviewActionStatus(status) {
  if (status === "ready" || status === "idle" || status === "complete" || status === "completed") return "ready";
  if (status === "pending" || status === "needsAcceptance" || status === "queued") return "pending";
  if (status === "blocked" || status === "failed" || status === "disabled") return "blocked";
  return "review";
}

function mailchimpPreviewActionStatusOrder(status) {
  return {
    blocked: 0,
    pending: 1,
    review: 2,
    ready: 3,
  }[status] ?? 4;
}

function inferMailchimpPreviewJobName(row = {}) {
  if (row.jobName) return String(row.jobName);
  const source = row.targetId ?? row.target ?? row.id ?? "";
  const parts = String(source).split(":").filter(Boolean);
  return parts.length > 1 && !parts[0].includes("/") ? parts[0] : null;
}

function createSourceRangeClientRoutesFromSummary(clientSummary = {}) {
  const rows = Array.isArray(clientSummary.rows) ? clientSummary.rows : [];
  return rows.map((row) => sourceRangeClientRouteRow({
    id: `summary:${row.id}`,
    origin: "clientSummary",
    kind: row.kind ?? "sourcePreview",
    status: row.status,
    label: row.label ?? row.id,
    detail: row.previewAddress
      ? `${row.label ?? row.id} previews at ${row.previewAddress}.`
      : row.detail ?? "Source preview route is prepared for client handoff.",
    route: row.route ?? clientSummary.restartEnvelope?.route ?? "source-ranges/client-acceptance",
    targetId: row.sourceId ?? row.operationId ?? row.id,
    accepted: row.accepted === true,
    acceptanceRequired: row.acceptanceRequired === true,
    restartSafe: row.restartSafe !== false,
    exportAllowed: row.status !== "blocked",
    previewAddress: row.previewAddress ?? null,
    externalUri: row.externalUri ?? null,
    idempotencyKey: row.idempotencyKey ?? `${clientSummary.syncKey ?? "source-summary"}:${row.id}`,
    nextAction: row.nextAction ?? clientSummary.restartEnvelope?.nextAction ?? "review-source-range-client-summary",
  }));
}

function createSourceRangeClientRoutesFromCommands(commandPacket = {}) {
  const commands = Array.isArray(commandPacket.commands) ? commandPacket.commands : [];
  return commands.map((command) => sourceRangeClientRouteRow({
    id: `command:${command.id}`,
    origin: "commandPacket",
    kind: command.intent ?? command.kind ?? "sourceCommand",
    status: command.status,
    label: command.label ?? command.sourceRowId ?? command.id,
    detail: `${command.intent ?? "source"} command uses ${command.route ?? "source-ranges/client-commands"}.`,
    route: command.route ?? commandPacket.restartEnvelope?.route ?? "source-ranges/client-commands",
    targetId: command.sourceId ?? command.operationId ?? command.sourceRowId ?? command.id,
    accepted: command.accepted === true,
    acceptanceRequired: command.acceptanceRequired === true,
    restartSafe: command.restartSafe !== false,
    exportAllowed: command.status !== "blocked",
    previewAddress: command.previewAddress ?? null,
    externalUri: command.externalUri ?? null,
    idempotencyKey: command.idempotencyKey ?? `${commandPacket.syncKey ?? "source-command"}:${command.id}`,
    nextAction: command.nextAction ?? commandPacket.restartEnvelope?.nextAction ?? "review-source-range-client-command",
  }));
}

function createSourceRangeClientRoutesFromActions(actionDeck = {}) {
  const rows = Array.isArray(actionDeck.rows) ? actionDeck.rows : [];
  return rows.map((row) => sourceRangeClientRouteRow({
    id: `action:${row.id}`,
    origin: "actionDeck",
    kind: row.kind ?? "sourceAction",
    status: row.status,
    label: row.label ?? row.id,
    detail: row.detail ?? `${row.kind ?? "source"} action is routed to ${row.route ?? "source-ranges/client-actions"}.`,
    route: row.route ?? actionDeck.restartEnvelope?.route ?? "source-ranges/client-actions",
    targetId: row.targetId ?? row.sourceId ?? row.id,
    accepted: row.accepted === true,
    acceptanceRequired: row.acceptanceRequired === true,
    restartSafe: row.restartSafe !== false,
    exportAllowed: row.exportAllowed !== false && row.status !== "blocked",
    previewAddress: row.previewAddress ?? null,
    externalUri: row.externalUri ?? null,
    idempotencyKey: row.idempotencyKey ?? `${actionDeck.syncKey ?? "source-action"}:${row.id}`,
    nextAction: row.nextAction ?? actionDeck.restartEnvelope?.nextAction ?? "review-source-range-client-action",
  }));
}

function createSourceRangeClientRoutesFromRuntimeResume(runtimeResume = {}) {
  const rows = Array.isArray(runtimeResume.rows) ? runtimeResume.rows : [];
  return rows.map((row) => sourceRangeClientRouteRow({
    id: `resume:${row.id}`,
    origin: "runtimeResume",
    kind: row.kind ?? "sourceResume",
    status: row.status,
    label: row.label ?? row.id,
    detail: row.detail ?? `${row.origin ?? "source"} resume row targets ${row.route ?? "source-ranges/runtime-resume"}.`,
    route: row.route ?? runtimeResume.restartEnvelope?.route ?? "source-ranges/runtime-resume",
    targetId: row.targetId ?? row.sourceId ?? row.id,
    accepted: row.accepted === true,
    acceptanceRequired: row.acceptanceRequired === true,
    restartSafe: row.restartSafe !== false,
    exportAllowed: row.status !== "blocked",
    previewAddress: row.previewAddress ?? null,
    externalUri: row.externalUri ?? null,
    idempotencyKey: row.idempotencyKey ?? `${runtimeResume.syncKey ?? "source-resume"}:${row.id}`,
    nextAction: row.nextAction ?? runtimeResume.restartEnvelope?.nextAction ?? "review-source-range-runtime-resume",
  }));
}

function createSourceRangeClientRoutesFromWorkflowQueue(workflowQueue = {}) {
  const rows = Array.isArray(workflowQueue.rows) ? workflowQueue.rows : [];
  return rows.map((row) => sourceRangeClientRouteRow({
    id: `workflow:${row.id}`,
    origin: "workflowQueue",
    kind: row.intent ?? row.kind ?? "sourceWorkflow",
    status: row.status,
    label: row.label ?? row.id,
    detail: row.detail ?? `${row.intent ?? "source"} workflow queue row uses ${row.route ?? "source-ranges/client-workflow/handoff"}.`,
    route: row.route ?? workflowQueue.restartEnvelope?.route ?? "source-ranges/client-workflow/handoff",
    targetId: row.targetId ?? row.sourceId ?? row.id,
    accepted: row.acceptanceState === "accepted" || row.accepted === true,
    acceptanceRequired: row.acceptanceRequired === true,
    completed: row.completed === true,
    restartSafe: row.restartSafe !== false,
    exportAllowed: row.status !== "blocked",
    previewAddress: row.previewAddress ?? null,
    externalUri: row.externalUri ?? null,
    idempotencyKey: row.idempotencyKey ?? `${workflowQueue.syncKey ?? "source-workflow"}:${row.id}`,
    nextAction: row.nextAction ?? workflowQueue.restartEnvelope?.nextAction ?? "review-source-range-workflow-queue",
  }));
}

function applySourceRangeClientRouteProgress(route, context) {
  const accepted = context.acceptedRouteIds.has(route.id) || route.accepted;
  const completed = context.completedRouteIds.has(route.id) || route.completed;
  const failed = context.failedRouteIds.has(route.id);
  const requiresAcceptance = context.requireAcceptance !== false && route.acceptanceRequired;
  const status = failed
    ? "blocked"
    : completed
      ? "ready"
      : requiresAcceptance && !accepted && route.status === "ready"
        ? "pending"
        : route.status;

  return Object.freeze({
    ...route,
    status,
    accepted,
    completed,
    failed,
    acceptanceRequired: requiresAcceptance,
    acceptanceState: requiresAcceptance ? accepted ? "accepted" : "pending" : "implicit",
    exportAllowed: route.exportAllowed !== false && status !== "blocked" && (!requiresAcceptance || accepted),
    restartSafe: route.restartSafe !== false && !failed,
    nextAction: failed
      ? "retry-source-range-client-route"
      : completed
        ? "retain-source-range-client-route"
        : requiresAcceptance && !accepted
          ? "accept-source-range-client-route"
          : route.nextAction,
  });
}

function sourceRangeClientRouteRow(row = {}) {
  const status = normalizeSourceRangeClientRouteStatus(row.status);
  const id = String(row.id ?? `${row.origin ?? "source"}:${row.route ?? "route"}`);
  return Object.freeze({
    id,
    origin: row.origin ?? "sourceRange",
    kind: row.kind ?? "sourceRoute",
    status,
    label: row.label ?? id,
    detail: row.detail ?? `${row.label ?? id} is ${status}.`,
    route: row.route ?? "source-ranges/client-route-handoff",
    targetId: row.targetId ?? null,
    accepted: row.accepted === true,
    completed: row.completed === true,
    failed: row.failed === true,
    acceptanceRequired: row.acceptanceRequired === true,
    acceptanceState: row.acceptanceRequired === true ? row.accepted === true ? "accepted" : "pending" : "implicit",
    restartSafe: row.restartSafe !== false,
    exportAllowed: row.exportAllowed !== false && status !== "blocked",
    previewAddress: row.previewAddress ?? null,
    externalUri: row.externalUri ?? null,
    idempotencyKey: row.idempotencyKey ?? `${id}:${status}`,
    nextAction: row.nextAction ?? selectSourceRangeClientRouteAction(status),
    userVisible: Object.freeze({
      label: row.label ?? id,
      detail: row.detail ?? `${row.route ?? "source route"} is ${status}.`,
      nextAction: row.nextAction ?? selectSourceRangeClientRouteAction(status),
    }),
  });
}

function dedupeSourceRangeClientRouteRows(rows = []) {
  const byId = new Map();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing || sourceRangeClientRouteStatusWeight(row.status) < sourceRangeClientRouteStatusWeight(existing.status)) {
      byId.set(row.id, row);
    }
  }
  return Object.freeze([...byId.values()]
    .sort((left, right) => sourceRangeClientRouteStatusWeight(left.status) - sourceRangeClientRouteStatusWeight(right.status)
      || left.origin.localeCompare(right.origin)
      || left.id.localeCompare(right.id)));
}

function normalizeSourceRangeClientRouteStatus(status) {
  if (status === "ready" || status === "idle") return status;
  if (status === "pending" || status === "needsAcceptance" || status === "queued") return "pending";
  if (status === "blocked" || status === "failed" || status === "disabled" || status === "required") return "blocked";
  if (status === "review" || status === "degraded" || status === "changed") return "review";
  return status ? "review" : "ready";
}

function selectSourceRangeClientRouteAction(status) {
  if (status === "blocked") return "repair-source-range-client-route";
  if (status === "pending") return "accept-source-range-client-route";
  if (status === "review") return "review-source-range-client-route";
  if (status === "idle") return "skip-source-range-client-route";
  return "publish-source-range-client-route";
}

function sourceRangeClientRouteStatusWeight(status) {
  return {
    blocked: 0,
    pending: 1,
    review: 2,
    ready: 3,
    idle: 4,
  }[status] ?? 5;
}

function createSourceRangeDeckRowsFromAcceptance(clientSummary = {}) {
  const rows = Array.isArray(clientSummary.rows) ? clientSummary.rows : [];
  return rows
    .filter((row) => row.status !== "ready" || row.acceptanceRequired)
    .map((row) => sourceRangeActionDeckRow({
      id: `acceptance:${row.id}`,
      source: "acceptance",
      kind: row.kind,
      status: normalizeSourceRangeActionDeckStatus(row.status),
      label: row.label,
      detail: row.previewAddress
        ? `${row.label} at ${row.previewAddress}.`
        : `${row.label} source handoff.`,
      route: row.route ?? clientSummary.restartEnvelope?.route ?? "source-ranges/client-acceptance",
      targetId: row.sourceId ?? row.operationId ?? row.id,
      accepted: row.accepted === true,
      acceptanceRequired: row.acceptanceRequired === true,
      restartSafe: row.restartSafe !== false,
      previewAddress: row.previewAddress ?? null,
      externalUri: row.externalUri ?? null,
      idempotencyKey: row.idempotencyKey ?? row.id,
      nextAction: row.nextAction ?? clientSummary.restartEnvelope?.nextAction ?? "review-source-range-acceptance",
    }));
}

function createSourceRangeDeckRowsFromCommands(commandPacket = {}) {
  const commands = Array.isArray(commandPacket.commands) ? commandPacket.commands : [];
  return commands
    .filter((command) => command.status !== "ready" || command.acceptanceRequired)
    .map((command) => sourceRangeActionDeckRow({
      id: `command:${command.id}`,
      source: "command",
      kind: command.intent ?? command.kind ?? "sourceCommand",
      status: normalizeSourceRangeActionDeckStatus(command.status),
      label: command.label ?? command.sourceRowId ?? command.id,
      detail: `${command.intent ?? "source"} command routes through ${command.route ?? "source-ranges/client-command"}.`,
      route: command.route ?? commandPacket.restartEnvelope?.route ?? "source-ranges/client-commands",
      targetId: command.sourceId ?? command.operationId ?? command.sourceRowId,
      accepted: command.accepted === true,
      acceptanceRequired: command.acceptanceRequired === true,
      restartSafe: command.restartSafe !== false,
      previewAddress: command.previewAddress ?? null,
      externalUri: command.externalUri ?? null,
      idempotencyKey: command.idempotencyKey ?? command.id,
      nextAction: command.nextAction ?? commandPacket.restartEnvelope?.nextAction ?? "review-source-range-command",
    }));
}

function createSourceRangeDeckRowsFromProvider(providerSummary = {}) {
  const capabilities = Array.isArray(providerSummary?.capabilities) ? providerSummary.capabilities : [];
  const anchors = Array.isArray(providerSummary?.anchors) ? providerSummary.anchors : [];
  const capabilityRows = capabilities
    .filter((capability) => capability.status !== "ready")
    .map((capability) => sourceRangeActionDeckRow({
      id: `provider-capability:${capability.id}`,
      source: "provider",
      kind: "providerCapability",
      status: normalizeSourceRangeActionDeckStatus(capability.status),
      label: capability.id,
      detail: `${capability.id} capability hands off through ${capability.handoff}.`,
      route: providerSummary.handoff?.route ?? "source-ranges/provider-export-summary",
      targetId: capability.id,
      restartSafe: capability.status !== "blocked",
      idempotencyKey: `${providerSummary.syncKey ?? "source-provider"}:${capability.id}`,
      nextAction: capability.nextAction ?? providerSummary.recovery?.nextAction ?? "review-source-range-capability",
    }));
  const anchorRows = anchors
    .filter((anchor) => anchor.status !== "ready" || anchor.accepted !== true)
    .map((anchor) => sourceRangeActionDeckRow({
      id: `provider-anchor:${anchor.id}`,
      source: "provider",
      kind: "providerAnchor",
      status: normalizeSourceRangeActionDeckStatus(anchor.status === "ready" && !anchor.accepted ? "pending" : anchor.status),
      label: anchor.name ? `${anchor.type} ${anchor.name}` : anchor.type ?? anchor.id,
      detail: anchor.previewAddress
        ? `Provider anchor uses ${anchor.previewAddress}.`
        : "Provider anchor needs source preview metadata.",
      route: providerSummary.handoff?.route ?? "source-ranges/provider-export-summary",
      targetId: anchor.id,
      accepted: anchor.accepted === true,
      acceptanceRequired: true,
      restartSafe: anchor.restartSafe !== false,
      previewAddress: anchor.previewAddress ?? null,
      idempotencyKey: anchor.idempotencyKey ?? `${providerSummary.syncKey ?? "source-provider"}:${anchor.id}`,
      nextAction: anchor.nextAction ?? providerSummary.recovery?.nextAction ?? "review-source-range-anchor",
    }));

  return [...capabilityRows, ...anchorRows];
}

function createSourceRangeDeckRowsFromRelease(releasePacket = {}) {
  const anchors = Array.isArray(releasePacket?.anchors) ? releasePacket.anchors : [];
  return anchors
    .filter((anchor) => anchor.status !== "ready" || anchor.accepted !== true || anchor.restartSafe === false)
    .map((anchor) => sourceRangeActionDeckRow({
      id: `release-anchor:${anchor.id}`,
      source: "release",
      kind: "releaseAnchor",
      status: normalizeSourceRangeActionDeckStatus(anchor.status === "ready" && !anchor.accepted ? "pending" : anchor.status),
      label: anchor.userVisible?.label ?? anchor.name ?? anchor.id,
      detail: anchor.userVisible?.detail ?? "Source release anchor needs action.",
      route: releasePacket.restartEnvelope?.route ?? "source-ranges/release",
      targetId: anchor.id,
      accepted: anchor.accepted === true,
      acceptanceRequired: true,
      restartSafe: anchor.restartSafe !== false,
      previewAddress: anchor.previewAddress ?? null,
      externalUri: anchor.externalUri ?? null,
      idempotencyKey: anchor.idempotencyKey ?? anchor.id,
      nextAction: anchor.userVisible?.nextAction ?? releasePacket.restartEnvelope?.nextAction ?? "review-source-release-anchor",
    }));
}

function createSourceRangeProviderBoundarySummaryRows(boundaryAudit = {}) {
  const auditEvents = Array.isArray(boundaryAudit?.auditEvents) ? boundaryAudit.auditEvents : [];
  return auditEvents.map((event) => Object.freeze({
    id: event.id,
    anchorId: event.anchorId,
    sourceId: event.sourceId ?? event.anchorId ?? null,
    type: event.type ?? "Unknown",
    name: event.name ?? null,
    status: normalizeSourceRangeActionDeckStatus(event.status),
    tenantId: event.tenantId ?? boundaryAudit.boundary?.tenantId ?? null,
    workspaceId: event.workspaceId ?? boundaryAudit.boundary?.workspaceId ?? null,
    role: event.role ?? boundaryAudit.boundary?.role ?? null,
    reason: event.reason ?? "within-boundary",
    restartSafe: event.restartSafe !== false && event.status !== "blocked",
    previewAddress: event.previewAddress ?? null,
    idempotencyKey: event.idempotencyKey ?? null,
    nextAction: event.nextAction ?? boundaryAudit.recovery?.nextAction ?? "review-source-range-boundary-audit",
  }));
}

function sourceRangeActionDeckRow(row) {
  return Object.freeze({
    id: row.id,
    source: row.source,
    kind: row.kind ?? "sourceRangeAction",
    status: row.status,
    label: row.label ?? row.id,
    detail: row.detail ?? "Source range action needs review.",
    route: row.route ?? "source-ranges/client-actions",
    handoff: "source-range-client-action",
    targetId: row.targetId ?? null,
    accepted: row.accepted === true,
    acceptanceRequired: row.acceptanceRequired === true,
    restartSafe: row.restartSafe !== false,
    previewAddress: row.previewAddress ?? null,
    externalUri: row.externalUri ?? null,
    idempotencyKey: row.idempotencyKey ?? null,
    nextAction: row.nextAction ?? "review-source-range-client-action",
  });
}

function normalizeSourceRangeActionDeckStatus(status) {
  if (status === "blocked" || status === "failed") return "blocked";
  if (status === "pending" || status === "needsAcceptance") return "pending";
  if (status === "review" || status === "changed" || status === "degraded") return "review";
  if (status === "idle") return "idle";
  return "ready";
}

function createSourceRangeWorkflowRowsFromClientSummary(clientSummary = {}) {
  const rows = Array.isArray(clientSummary.rows) ? clientSummary.rows : [];
  return rows.map((row) => sourceRangeWorkflowQueueRow({
    id: `client:${row.id}`,
    origin: "clientAcceptance",
    intent: row.status === "blocked"
      ? "recover"
      : row.acceptanceRequired && !row.accepted
        ? "accept"
        : row.status === "review" || row.status === "changed"
          ? "review"
          : "retain",
    status: row.status,
    label: row.label,
    detail: row.previewAddress
      ? `${row.label} hands off from ${row.previewAddress}.`
      : `${row.label} source acceptance handoff.`,
    route: row.route ?? clientSummary.restartEnvelope?.route,
    targetId: row.sourceId ?? row.operationId ?? row.id,
    accepted: row.accepted,
    acceptanceRequired: row.acceptanceRequired,
    restartSafe: row.restartSafe,
    previewAddress: row.previewAddress,
    externalUri: row.externalUri,
    idempotencyKey: row.idempotencyKey,
    nextAction: row.nextAction ?? clientSummary.restartEnvelope?.nextAction,
  }));
}

function createSourceRangeWorkflowRowsFromCommandPacket(commandPacket = {}) {
  const commands = Array.isArray(commandPacket.commands) ? commandPacket.commands : [];
  return commands.map((command) => sourceRangeWorkflowQueueRow({
    id: `command:${command.id}`,
    origin: "clientCommand",
    intent: command.intent ?? "retain",
    status: command.status,
    label: command.label ?? command.id,
    detail: `${command.intent ?? "source"} command hands off through ${command.route ?? commandPacket.restartEnvelope?.route ?? "source-ranges/client-commands"}.`,
    route: command.route ?? commandPacket.restartEnvelope?.route,
    targetId: command.sourceId ?? command.operationId ?? command.sourceRowId,
    accepted: command.accepted,
    acceptanceRequired: command.acceptanceRequired,
    restartSafe: command.restartSafe,
    previewAddress: command.previewAddress,
    externalUri: command.externalUri,
    idempotencyKey: command.idempotencyKey,
    nextAction: command.nextAction ?? commandPacket.restartEnvelope?.nextAction,
  }));
}

function createSourceRangeWorkflowRowsFromActionDeck(actionDeck = {}) {
  const rows = Array.isArray(actionDeck.rows) ? actionDeck.rows : [];
  return rows.map((row) => sourceRangeWorkflowQueueRow({
    id: `action:${row.id}`,
    origin: "actionDeck",
    intent: row.status === "blocked"
      ? "recover"
      : row.status === "pending" || row.acceptanceRequired && !row.accepted
        ? "accept"
        : row.status === "review" || row.status === "changed" || row.status === "degraded"
          ? "review"
          : "retain",
    status: row.status,
    label: row.label,
    detail: row.detail,
    route: row.route ?? actionDeck.restartEnvelope?.route,
    targetId: row.targetId,
    accepted: row.accepted,
    acceptanceRequired: row.acceptanceRequired,
    restartSafe: row.restartSafe,
    previewAddress: row.previewAddress,
    externalUri: row.externalUri,
    idempotencyKey: row.idempotencyKey,
    nextAction: row.nextAction ?? actionDeck.restartEnvelope?.nextAction,
  }));
}

function createSourceRangeWorkflowRowsFromRuntimeResume(runtimeResume = {}) {
  const rows = Array.isArray(runtimeResume.rows) ? runtimeResume.rows : [];
  return rows.map((row) => sourceRangeWorkflowQueueRow({
    id: `resume:${row.id}`,
    origin: "runtimeResume",
    intent: row.status === "blocked"
      ? "recover"
      : row.status === "pending"
        ? "accept"
        : row.status === "review"
          ? "review"
          : "retain",
    status: row.status,
    label: row.label,
    detail: row.detail,
    route: row.route ?? runtimeResume.restartEnvelope?.route,
    targetId: row.targetId,
    accepted: row.accepted,
    acceptanceRequired: row.status === "pending",
    restartSafe: row.restartSafe,
    previewAddress: row.previewAddress,
    externalUri: row.externalUri,
    idempotencyKey: row.idempotencyKey,
    nextAction: row.nextAction ?? runtimeResume.restartEnvelope?.nextAction,
  }));
}

function applySourceRangeWorkflowQueueProgress(row, context) {
  const completed = context.completedQueueIds.has(row.id);
  const failed = context.failedQueueIds.has(row.id);
  const retryRequested = context.retryQueueIds.has(row.id);
  const accepted = context.requireAcceptance === false
    || context.acceptedQueueIds.has(row.id)
    || row.acceptanceRequired === false
    || row.accepted === true;
  const status = failed || row.status === "blocked" || row.restartSafe === false
    ? "blocked"
    : completed
      ? "ready"
      : retryRequested
        ? "pending"
        : row.acceptanceRequired && !accepted
          ? "pending"
          : row.status;

  return Object.freeze({
    ...row,
    status,
    accepted,
    completed,
    retryRequested,
    acceptanceState: accepted ? "accepted" : row.acceptanceRequired ? "pending" : "notRequired",
    nextAction: failed
      ? "repair-source-workflow-handoff-queue"
      : completed
        ? "retain-source-workflow-handoff-row"
        : retryRequested
          ? `retry-source-workflow-handoff-row:${row.id}`
          : row.acceptanceRequired && !accepted
            ? `accept-source-workflow-handoff-row:${row.id}`
            : row.nextAction,
  });
}

function sourceRangeWorkflowQueueRow(row = {}) {
  const status = normalizeSourceRangeActionDeckStatus(row.status);
  return Object.freeze({
    id: row.id,
    origin: row.origin ?? "sourceRange",
    intent: row.intent ?? "retain",
    status,
    label: row.label ?? row.id,
    detail: row.detail ?? "Source workflow handoff row needs review.",
    route: row.route ?? "source-ranges/client-workflow/handoff",
    targetId: row.targetId ?? null,
    accepted: row.accepted === true,
    completed: false,
    retryRequested: false,
    acceptanceRequired: row.acceptanceRequired === true,
    acceptanceState: row.accepted === true ? "accepted" : row.acceptanceRequired === true ? "pending" : "notRequired",
    restartSafe: row.restartSafe !== false && status !== "blocked",
    previewAddress: row.previewAddress ?? null,
    externalUri: row.externalUri ?? null,
    idempotencyKey: row.idempotencyKey ?? row.id ?? null,
    nextAction: row.nextAction ?? (
      status === "blocked"
        ? "repair-source-workflow-handoff-queue"
        : status === "pending"
          ? "accept-source-workflow-handoff-queue"
          : status === "review"
            ? "review-source-workflow-handoff-queue"
            : "retain-source-workflow-handoff-queue"
    ),
  });
}

function dedupeSourceRangeWorkflowQueueRows(rows = []) {
  const byTarget = new Map();
  for (const row of rows) {
    const key = [
      row.origin,
      row.intent,
      row.targetId ?? row.id,
      row.route,
    ].join(":");
    const current = byTarget.get(key);
    if (!current || compareSourceRangeWorkflowQueuePriority(row, current) < 0) {
      byTarget.set(key, row);
    }
  }
  return [...byTarget.values()].sort(compareSourceRangeWorkflowQueueRows);
}

function compareSourceRangeWorkflowQueuePriority(left, right) {
  return sourceRangeResumeStatusRank(left.status) - sourceRangeResumeStatusRank(right.status)
    || Number(left.completed === true) - Number(right.completed === true)
    || Number(left.restartSafe === true) - Number(right.restartSafe === true)
    || left.id.localeCompare(right.id);
}

function compareSourceRangeWorkflowQueueRows(left, right) {
  return sourceRangeResumeStatusRank(left.status) - sourceRangeResumeStatusRank(right.status)
    || left.origin.localeCompare(right.origin)
    || left.intent.localeCompare(right.intent)
    || left.id.localeCompare(right.id);
}

function normalizeSourceRangeHandoffIdSet(ids = []) {
  return new Set((Array.isArray(ids) ? ids : [])
    .map((id) => String(id).trim())
    .filter(Boolean));
}

function createSourceRangeResumeRowsFromClientSummary(clientSummary = {}) {
  const rows = Array.isArray(clientSummary.rows) ? clientSummary.rows : [];
  return rows.map((row) => sourceRangeResumeRow({
    id: `client:${row.id}`,
    origin: "clientAcceptance",
    kind: row.kind,
    status: row.status,
    label: row.label,
    detail: row.previewAddress
      ? `${row.label} resumes from ${row.previewAddress}.`
      : `${row.label} resumes through source client acceptance.`,
    route: row.route ?? clientSummary.restartEnvelope?.route,
    targetId: row.sourceId ?? row.operationId ?? row.id,
    accepted: row.accepted,
    restartSafe: row.restartSafe,
    previewAddress: row.previewAddress,
    externalUri: row.externalUri,
    idempotencyKey: row.idempotencyKey,
    nextAction: row.nextAction ?? clientSummary.restartEnvelope?.nextAction,
  }));
}

function createSourceRangeResumeRowsFromCommandPacket(commandPacket = {}) {
  const commands = Array.isArray(commandPacket.commands) ? commandPacket.commands : [];
  return commands.map((command) => sourceRangeResumeRow({
    id: `command:${command.id}`,
    origin: "clientCommand",
    kind: command.intent ?? command.kind,
    status: command.status,
    label: command.label ?? command.id,
    detail: `${command.intent ?? "source"} command resumes through ${command.route}.`,
    route: command.route ?? commandPacket.restartEnvelope?.route,
    targetId: command.sourceId ?? command.operationId ?? command.sourceRowId,
    accepted: command.accepted,
    restartSafe: command.restartSafe,
    previewAddress: command.previewAddress,
    externalUri: command.externalUri,
    idempotencyKey: command.idempotencyKey,
    nextAction: command.nextAction ?? commandPacket.restartEnvelope?.nextAction,
  }));
}

function createSourceRangeResumeRowsFromActionDeck(actionDeck = {}) {
  const rows = Array.isArray(actionDeck.rows) ? actionDeck.rows : [];
  return rows.map((row) => sourceRangeResumeRow({
    id: `action:${row.id}`,
    origin: "actionDeck",
    kind: row.kind,
    status: row.status,
    label: row.label,
    detail: row.detail,
    route: row.route ?? actionDeck.restartEnvelope?.route,
    targetId: row.targetId,
    accepted: row.accepted,
    restartSafe: row.restartSafe,
    previewAddress: row.previewAddress,
    externalUri: row.externalUri,
    idempotencyKey: row.idempotencyKey,
    nextAction: row.nextAction ?? actionDeck.restartEnvelope?.nextAction,
  }));
}

function createSourceRangeResumeRowsFromBoundaryAudit(boundaryAudit = {}) {
  const events = Array.isArray(boundaryAudit?.auditEvents) ? boundaryAudit.auditEvents : [];
  return events
    .filter((event) => event.status !== "ready" || event.restartSafe === false)
    .map((event) => sourceRangeResumeRow({
      id: `boundary:${event.id}`,
      origin: "tenantBoundary",
      kind: "boundaryAudit",
      status: event.status,
      label: event.anchorId ?? event.id,
      detail: event.reason ?? "Source anchor boundary audit needs runtime resume.",
      route: boundaryAudit.restartEnvelope?.route ?? "source-ranges/boundary-summary",
      targetId: event.anchorId,
      accepted: event.status !== "pending",
      restartSafe: event.restartSafe,
      previewAddress: event.previewAddress,
      idempotencyKey: event.idempotencyKey,
      nextAction: event.nextAction ?? boundaryAudit.restartEnvelope?.nextAction,
    }));
}

function createSourceRangeResumeRowsFromProviderSummary(providerSummary = {}) {
  const anchors = Array.isArray(providerSummary?.anchors) ? providerSummary.anchors : [];
  const capabilities = Array.isArray(providerSummary?.capabilities) ? providerSummary.capabilities : [];
  const anchorRows = anchors
    .filter((anchor) => anchor.status !== "ready" || anchor.restartSafe === false || anchor.accepted === false)
    .map((anchor) => sourceRangeResumeRow({
      id: `provider-anchor:${anchor.id}`,
      origin: "providerSummary",
      kind: "providerAnchor",
      status: anchor.status === "ready" && anchor.accepted === false ? "pending" : anchor.status,
      label: anchor.name ? `${anchor.type} ${anchor.name}` : anchor.type ?? anchor.id,
      detail: anchor.previewAddress
        ? `Provider anchor resumes from ${anchor.previewAddress}.`
        : "Provider anchor needs preview metadata before resume.",
      route: providerSummary.handoff?.route,
      targetId: anchor.id,
      accepted: anchor.accepted,
      restartSafe: anchor.restartSafe,
      previewAddress: anchor.previewAddress,
      idempotencyKey: anchor.idempotencyKey ?? `${providerSummary.syncKey ?? "source-provider"}:${anchor.id}`,
      nextAction: anchor.nextAction ?? providerSummary.recovery?.nextAction,
    }));
  const capabilityRows = capabilities
    .filter((capability) => capability.status !== "ready")
    .map((capability) => sourceRangeResumeRow({
      id: `provider-capability:${capability.id}`,
      origin: "providerSummary",
      kind: "providerCapability",
      status: capability.status,
      label: capability.id,
      detail: `${capability.id} capability resumes through ${capability.handoff}.`,
      route: providerSummary.handoff?.route,
      targetId: capability.id,
      accepted: capability.status !== "pending",
      restartSafe: capability.status !== "blocked",
      idempotencyKey: `${providerSummary.syncKey ?? "source-provider"}:${capability.id}`,
      nextAction: capability.nextAction ?? providerSummary.recovery?.nextAction,
    }));

  return [...anchorRows, ...capabilityRows];
}

function sourceRangeResumeRow(row = {}) {
  const status = normalizeSourceRangeActionDeckStatus(row.status);
  return Object.freeze({
    id: row.id,
    origin: row.origin ?? "sourceRange",
    kind: row.kind ?? "resume",
    status,
    label: row.label ?? row.id,
    detail: row.detail ?? "Source range resume row needs review.",
    route: row.route ?? "source-ranges/runtime-resume/summary",
    targetId: row.targetId ?? null,
    accepted: row.accepted === true,
    restartSafe: row.restartSafe !== false && status !== "blocked",
    previewAddress: row.previewAddress ?? null,
    externalUri: row.externalUri ?? null,
    idempotencyKey: row.idempotencyKey ?? row.id ?? null,
    nextAction: row.nextAction ?? (
      status === "blocked"
        ? "repair-source-range-runtime-resume"
        : status === "pending"
          ? "accept-source-range-runtime-resume"
          : status === "review"
            ? "review-source-range-runtime-resume"
            : "retain-source-range-runtime-resume"
    ),
  });
}

function dedupeSourceRangeResumeRows(rows = []) {
  const byId = new Map();
  for (const row of rows) {
    const current = byId.get(row.id);
    if (!current || compareSourceRangeResumePriority(row, current) < 0) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort(compareSourceRangeResumeRows);
}

function compareSourceRangeResumePriority(left, right) {
  return sourceRangeResumeStatusRank(left.status) - sourceRangeResumeStatusRank(right.status)
    || Number(left.restartSafe === true) - Number(right.restartSafe === true)
    || left.id.localeCompare(right.id);
}

function sourceRangeResumeStatusRank(status) {
  if (status === "blocked") return 0;
  if (status === "pending") return 1;
  if (status === "review") return 2;
  if (status === "ready") return 3;
  return 4;
}

function compareSourceRangeResumeRows(left, right) {
  return sourceRangeResumeStatusRank(left.status) - sourceRangeResumeStatusRank(right.status)
    || left.origin.localeCompare(right.origin)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

function compareSourceRangeActionDeckRows(left, right) {
  return left.status.localeCompare(right.status)
    || left.source.localeCompare(right.source)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

export function negotiateSourceRangeCapabilities(requested = [], context = {}) {
  const requestedSet = new Set(requested.length ? requested : Object.keys(AIOS_SOURCE_RANGE_PROVIDER_CAPABILITIES));
  return Object.freeze(Object.values(AIOS_SOURCE_RANGE_PROVIDER_CAPABILITIES)
    .filter((capability) => requestedSet.has(capability.id))
    .map((capability) => {
      const available = capability.id === "externalUri"
        ? Boolean(context.hasExternalBaseUri)
        : capability.id === "highlight"
          ? context.canHighlight !== false
          : true;
      const status = available ? "ready" : capability.required ? "blocked" : "degraded";
      return Object.freeze({
        id: capability.id,
        required: capability.required,
        status,
        handoff: capability.handoff,
        nextAction: status === "ready"
          ? "include-capability"
          : capability.required
            ? `enable-${capability.id}`
            : `omit-${capability.id}`,
      });
    })
    .sort((left, right) => left.id.localeCompare(right.id)));
}

function createSourceRangeClientCommand(row, context) {
  const requested = new Set((Array.isArray(context.requestedCommandIds) ? context.requestedCommandIds : [])
    .map((id) => String(id).trim())
    .filter(Boolean));
  const completed = new Set((Array.isArray(context.completedCommandIds) ? context.completedCommandIds : [])
    .map((id) => String(id).trim())
    .filter(Boolean));
  const failed = new Set((Array.isArray(context.failedCommandIds) ? context.failedCommandIds : [])
    .map((id) => String(id).trim())
    .filter(Boolean));
  const intent = row.status === "blocked"
    ? "recover"
    : row.status === "pending" || row.status === "needsAcceptance"
      ? "accept"
      : row.status === "review" || row.status === "changed" || row.status === "degraded"
        ? "review"
        : "retain";
  const id = `${intent}:${row.id}`;
  const failedCommand = failed.has(id);
  const completedCommand = completed.has(id);
  const requestedCommand = requested.has(id);
  const status = failedCommand || row.status === "blocked" || row.restartSafe === false
    ? "blocked"
    : completedCommand
      ? "ready"
      : intent === "accept" || (context.requireAcceptance && row.acceptanceRequired && !row.accepted)
        ? "pending"
        : intent === "review"
          ? "review"
          : requestedCommand
            ? "pending"
            : "ready";
  const route = intent === "recover"
    ? row.route
    : intent === "accept"
      ? "source-ranges/client-command-acceptance"
      : intent === "review"
        ? "source-ranges/client-command-review"
        : "source-ranges/client-command-retain";

  return Object.freeze({
    id,
    kind: row.kind,
    intent,
    status,
    sourceRowId: row.id,
    sourceId: row.sourceId ?? null,
    operationId: row.operationId ?? null,
    jobName: row.jobName ?? null,
    label: row.label,
    route,
    handoff: "source-range-client-command",
    accepted: row.accepted === true || completedCommand,
    acceptanceRequired: row.acceptanceRequired === true,
    restartSafe: row.restartSafe !== false && !failedCommand,
    previewAddress: row.previewAddress ?? null,
    externalUri: row.externalUri ?? null,
    idempotencyKey: [
      context.clientSummary.syncKey,
      row.idempotencyKey ?? row.id,
      intent,
    ].join("|"),
    nextAction: failedCommand
      ? row.nextAction ?? "repair-source-range-client-command"
      : status === "pending"
        ? intent === "accept" ? row.nextAction ?? "accept-source-range-client-command" : "resume-source-range-client-command"
        : status === "review"
          ? row.nextAction ?? "review-source-range-client-command"
          : row.nextAction ?? "retain-source-range-client-command",
  });
}

function compareSourceRangeClientCommands(left, right) {
  return left.status.localeCompare(right.status)
    || left.intent.localeCompare(right.intent)
    || left.id.localeCompare(right.id);
}

function createMailchimpSourceAnchorRows(state) {
  const anchors = state.releasePacket?.anchors ?? state.persistence?.anchors ?? state.manifest?.anchors ?? [];
  const entriesByName = new Map((state.providerContract?.index?.entries ?? [])
    .filter((entry) => entry.type === "JobDeclaration" && entry.name)
    .map((entry) => [String(entry.name), entry]));
  const rows = new Map();

  for (const anchor of anchors) {
    const jobName = anchor.name ?? anchor.jobName ?? null;
    if (!jobName) continue;
    const entry = entriesByName.get(String(jobName)) ?? null;
    const previewAddress = anchor.previewAddress ?? anchor.compact ?? entry?.compact ?? null;
    const external = previewAddress ? state.externalByPreviewAddress.get(previewAddress) ?? null : null;
    rows.set(String(jobName), Object.freeze({
      id: anchor.id,
      jobName: String(jobName),
      type: anchor.type ?? entry?.type ?? "JobDeclaration",
      status: anchor.status ?? "unknown",
      anchorStatus: anchor.status ?? "unknown",
      accepted: anchor.accepted === true,
      restartSafe: anchor.restartSafe !== false,
      previewAddress,
      externalUri: anchor.externalUri ?? external?.externalUri ?? null,
      range: entry?.range ?? null,
      nextAction: anchor.nextAction ?? "review-source-range-anchor",
      idempotencyKey: anchor.idempotencyKey ?? null,
    }));
  }

  return rows;
}

function createMailchimpOperationSourceAnchor(operation, context) {
  const anchor = context.anchorsByJobName.get(String(operation.jobName ?? "")) ?? null;
  const providerBlocked = context.providerStatus === "blocked" || context.providerSummary?.status === "blocked";
  const missing = !anchor;
  const blocked = providerBlocked || missing || anchor.status === "blocked" || anchor.restartSafe === false;
  const pending = !blocked && context.requireAcceptance && !anchor.accepted;
  const review = !blocked && !pending && (anchor.status === "changed" || anchor.status === "review");
  const status = blocked ? "blocked" : pending ? "pending" : review ? "review" : "ready";
  const nextAction = providerBlocked
    ? context.providerSummary?.handoff?.nextAction ?? "repair-source-range-provider"
    : missing
      ? "bind-mailchimp-operation-source-anchor"
      : blocked
        ? anchor.nextAction
        : pending
          ? "accept-mailchimp-source-anchor"
          : review
            ? "review-mailchimp-source-anchor"
            : "retain-mailchimp-source-anchor";

  return Object.freeze({
    id: `mailchimp-source-anchor:${operation.id ?? operation.operationId ?? operation.jobName ?? "operation"}`,
    operationId: operation.id ?? operation.operationId ?? null,
    commandId: operation.commandId ?? null,
    jobName: operation.jobName ?? null,
    service: operation.service ?? "mailchimp",
    operation: operation.operation ?? operation.action ?? "handoff",
    status,
    accepted: anchor?.accepted === true,
    anchorId: anchor?.id ?? null,
    anchorStatus: anchor?.status ?? "missing",
    previewAddress: anchor?.previewAddress ?? null,
    externalUri: anchor?.externalUri ?? null,
    range: anchor?.range ?? null,
    handoff: "mailchimp-source-anchor",
    restartSafe: !blocked,
    idempotencyKey: [
      operation.id ?? operation.operationId ?? operation.jobName ?? "operation",
      anchor?.idempotencyKey ?? anchor?.id ?? "source-anchor-unbound",
    ].join(":"),
    nextAction,
  });
}

function compareMailchimpSourceAnchors(left, right) {
  return left.status.localeCompare(right.status)
    || String(left.jobName ?? "").localeCompare(String(right.jobName ?? ""))
    || String(left.operationId ?? "").localeCompare(String(right.operationId ?? ""));
}

function compareSourceAnchorRows(left, right) {
  return left.status.localeCompare(right.status)
    || String(left.jobName ?? "").localeCompare(String(right.jobName ?? ""))
    || String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

function createMailchimpProviderSourceDeploymentRows(context) {
  const serviceRows = Array.isArray(context.providerServiceReadiness.rows) ? context.providerServiceReadiness.rows : [];
  const exportRowsByLane = new Map((context.providerServiceHandoff?.lanes ?? [])
    .map((lane) => [lane.id, lane]));
  const exportDeckRowsByLane = new Map((context.providerServiceExportDeck?.rows ?? [])
    .map((row) => [row.laneId ?? row.id, row]));
  const serviceDeploymentRows = serviceRows.map((serviceRow) => createMailchimpProviderSourceDeploymentRow(serviceRow, {
    ...context,
    handoffLane: exportRowsByLane.get("service-readiness") ?? null,
    exportRow: exportDeckRowsByLane.get("service-readiness") ?? null,
  }));
  const servicesWithLanes = new Set(serviceDeploymentRows.map((row) => row.service).filter(Boolean));
  const sourceOnlyRows = [...context.sourceRowsByService.entries()]
    .filter(([service]) => !servicesWithLanes.has(service))
    .map(([service, sourceRows]) => createMailchimpProviderSourceDeploymentRow({
      id: `source-only:${service}`,
      service,
      status: "review",
      label: `${service} source anchors`,
      route: "mailchimp/source-anchor/handoff",
      handoff: "mailchimp-source-anchor",
      restartSafe: sourceRows.every((row) => row.restartSafe),
      exportAllowed: sourceRows.every((row) => row.status !== "blocked"),
      nextAction: "bind-mailchimp-provider-service-lane",
    }, {
      ...context,
      handoffLane: null,
      exportRow: null,
    }));

  return Object.freeze([...serviceDeploymentRows, ...sourceOnlyRows].sort(compareMailchimpProviderSourceDeploymentRows));
}

function createMailchimpProviderSourceDeploymentRow(lane = {}, context = {}) {
  const service = normalizeMailchimpProviderSourceService(lane.service ?? lane.id);
  const sourceRows = context.sourceRowsByService.get(service) ?? [];
  const blockedSources = sourceRows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pendingSources = sourceRows.filter((row) => row.status === "pending");
  const reviewSources = sourceRows.filter((row) => row.status === "review");
  const exportRow = context.exportRow;
  const handoffLane = context.handoffLane;
  const laneBlocked = lane.status === "blocked"
    || lane.restartSafe === false
    || lane.exportAllowed === false
    || handoffLane?.status === "blocked"
    || handoffLane?.restartSafe === false
    || handoffLane?.exportAllowed === false
    || exportRow?.status === "blocked"
    || exportRow?.restartSafe === false
    || exportRow?.exportAllowed === false;
  const lanePending = lane.status === "pending" || handoffLane?.status === "pending" || exportRow?.status === "pending";
  const laneReview = lane.status === "review" || lane.status === "degraded" || handoffLane?.status === "review" || exportRow?.status === "review";
  const missingSource = sourceRows.length === 0 && service !== "provider";
  const accepted = context.accepted.has(lane.id) || context.accepted.has(`mailchimp-provider-source:${lane.id}`);
  const completed = context.completed.has(lane.id) || context.completed.has(`mailchimp-provider-source:${lane.id}`);
  const failed = context.failed.has(lane.id) || context.failed.has(`mailchimp-provider-source:${lane.id}`);
  const blocked = failed || laneBlocked || blockedSources.length > 0 || missingSource;
  const pending = !blocked && context.requireAcceptance && !accepted;
  const review = !blocked && !pending && (lanePending || laneReview || pendingSources.length || reviewSources.length);
  const status = blocked ? "blocked" : pending ? "pending" : review ? "review" : "ready";
  const nextAction = failed
    ? "retry-mailchimp-provider-source-deployment"
    : missingSource
      ? "bind-mailchimp-provider-source-anchor"
      : laneBlocked
        ? lane.nextAction ?? handoffLane?.nextAction ?? exportRow?.nextAction ?? "repair-mailchimp-provider-service-handoff"
        : blockedSources[0]?.nextAction
          ?? (pending ? "accept-mailchimp-provider-source-deployment" : null)
          ?? pendingSources[0]?.nextAction
          ?? reviewSources[0]?.nextAction
          ?? (laneReview ? lane.nextAction ?? handoffLane?.nextAction ?? exportRow?.nextAction : null)
          ?? "publish-mailchimp-provider-source-deployment";

  return Object.freeze({
    id: `mailchimp-provider-source:${lane.id ?? service}`,
    laneId: lane.id ?? null,
    service,
    status,
    providerLaneStatus: lane.status ?? "unbound",
    providerHandoffStatus: handoffLane?.status ?? "unbound",
    providerExportStatus: exportRow?.status ?? "unbound",
    sourceStatus: blockedSources.length ? "blocked" : pendingSources.length ? "pending" : reviewSources.length ? "review" : sourceRows.length ? "ready" : "missing",
    accepted,
    completed,
    failed,
    restartSafe: !blocked && sourceRows.every((row) => row.restartSafe !== false),
    exportAllowed: status === "ready" || status === "review",
    label: lane.label ?? `${service} provider source deployment`,
    detail: `${sourceRows.filter((row) => row.anchorId).length} of ${sourceRows.length} Mailchimp ${service} operation(s) have source anchors.`,
    route: lane.route ?? handoffLane?.route ?? exportRow?.route ?? "mailchimp/provider-source-deployment",
    handoff: "mailchimp-provider-source-deployment",
    anchoredOperationCount: sourceRows.filter((row) => row.anchorId).length,
    sourceOperationCount: sourceRows.length,
    blockedSourceOperationIds: Object.freeze(blockedSources.map((row) => row.operationId).filter(Boolean).sort()),
    pendingSourceOperationIds: Object.freeze(pendingSources.map((row) => row.operationId).filter(Boolean).sort()),
    sourceAnchorIds: Object.freeze(sourceRows.map((row) => row.anchorId).filter(Boolean).sort()),
    idempotencyKey: [
      lane.id ?? service,
      lane.idempotencyKey ?? lane.syncKey ?? lane.status ?? "lane-unbound",
      handoffLane?.idempotencyKey ?? handoffLane?.status ?? "handoff-unbound",
      exportRow?.idempotencyKey ?? exportRow?.status ?? "export-unbound",
      sourceRows.map((row) => row.idempotencyKey).filter(Boolean).sort().join(".") || "source-unbound",
      context.revision,
    ].join(":"),
    nextAction,
  });
}

function groupMailchimpSourceAnchorsByService(operationAnchors = []) {
  const groups = new Map();
  for (const anchor of Array.isArray(operationAnchors) ? operationAnchors : []) {
    const service = normalizeMailchimpProviderSourceService(anchor.service);
    const current = groups.get(service) ?? [];
    current.push(anchor);
    groups.set(service, current);
  }
  return groups;
}

function normalizeMailchimpProviderSourceService(value) {
  const raw = String(value ?? "provider").trim();
  if (!raw) return "provider";
  if (raw.includes("campaign")) return "campaign";
  if (raw.includes("audience")) return "audience";
  if (raw.includes("template")) return "template";
  if (raw.includes("report")) return "report";
  return raw.replace(/^service-/, "");
}

function normalizeSourceRangeIdSet(value) {
  return new Set((Array.isArray(value) ? value : [])
    .map((id) => String(id).trim())
    .filter(Boolean));
}

function compareMailchimpProviderSourceDeploymentRows(left, right) {
  return left.status.localeCompare(right.status)
    || String(left.service ?? "").localeCompare(String(right.service ?? ""))
    || String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

function createSourceRangeClientSourceRows(state) {
  const anchors = state.releasePacket?.anchors ?? state.persistence?.anchors ?? state.manifest?.anchors ?? [];
  const pendingIds = new Set(state.providerSummary?.recovery?.pendingAnchorIds ?? []);
  const blockedIds = new Set(state.providerSummary?.recovery?.blockedAnchorIds ?? []);

  return anchors.map((anchor) => {
    const accepted = anchor.accepted === true;
    const blocked = blockedIds.has(anchor.id) || anchor.status === "blocked" || anchor.restartSafe === false;
    const pending = !blocked && state.requireAcceptance && !accepted;
    const review = !blocked && !pending && (anchor.status === "changed" || anchor.status === "review" || pendingIds.has(anchor.id));
    const status = blocked ? "blocked" : pending ? "pending" : review ? "review" : "ready";
    const nextAction = blocked
      ? anchor.nextAction ?? state.providerSummary?.recovery?.nextAction ?? "repair-source-range-anchor"
      : pending
        ? "accept-source-range-anchor"
        : review
          ? "review-source-range-anchor"
          : "retain-source-range-anchor";

    return Object.freeze({
      id: `source-anchor:${anchor.id}`,
      kind: "sourceAnchor",
      sourceId: anchor.id,
      status,
      accepted,
      acceptanceRequired: state.requireAcceptance,
      label: anchor.name ? `${anchor.type} ${anchor.name}` : anchor.type ?? "Source anchor",
      route: status === "blocked"
        ? "source-ranges/anchor-recovery"
        : status === "pending"
          ? "source-ranges/anchor-acceptance"
          : "source-ranges/anchor-summary",
      restartSafe: !blocked,
      previewAddress: anchor.previewAddress ?? anchor.compact ?? null,
      externalUri: anchor.externalUri ?? null,
      idempotencyKey: anchor.idempotencyKey ?? null,
      nextAction,
    });
  });
}

function createSourceRangeClientMailchimpRows(handoff, options) {
  const operationAnchors = Array.isArray(handoff?.operationAnchors) ? handoff.operationAnchors : [];
  return operationAnchors.map((anchor) => {
    const blocked = anchor.status === "blocked" || anchor.restartSafe === false;
    const pending = !blocked && options.requireAcceptance && anchor.status === "pending";
    const review = !blocked && !pending && anchor.status === "review";
    const status = blocked ? "blocked" : pending ? "pending" : review ? "review" : "ready";

    return Object.freeze({
      id: `mailchimp-operation-anchor:${anchor.operationId ?? anchor.id}`,
      kind: "mailchimpOperationAnchor",
      sourceId: anchor.anchorId,
      operationId: anchor.operationId,
      commandId: anchor.commandId,
      jobName: anchor.jobName,
      status,
      accepted: anchor.accepted === true,
      acceptanceRequired: options.requireAcceptance,
      label: anchor.jobName
        ? `${anchor.jobName} Mailchimp source anchor`
        : "Mailchimp operation source anchor",
      route: status === "blocked"
        ? "mailchimp/source-anchor/recovery"
        : status === "pending"
          ? "mailchimp/source-anchor/acceptance"
          : status === "review"
            ? "mailchimp/source-anchor/review"
            : "mailchimp/source-anchor/summary",
      restartSafe: !blocked,
      previewAddress: anchor.previewAddress ?? null,
      externalUri: anchor.externalUri ?? null,
      idempotencyKey: anchor.idempotencyKey ?? null,
      nextAction: anchor.nextAction ?? (
        status === "pending" ? "accept-mailchimp-source-anchor" : "retain-mailchimp-source-anchor"
      ),
    });
  });
}

function createSourceRangeClientOperationRows(timeline, providerSummary) {
  const events = Array.isArray(timeline?.events) ? timeline.events : [];
  const rows = events
    .filter((event) => event.status !== "ready" && event.status !== "idle" && event.status !== "unbound")
    .map((event) => {
      const blocked = event.status === "blocked" || event.restartSafe === false;
      const pending = !blocked && event.status === "pending";
      const review = !blocked && !pending && (event.status === "review" || event.reviewIds?.length);
      const status = blocked ? "blocked" : pending ? "pending" : review ? "review" : event.status;
      return Object.freeze({
        id: `source-operation:${event.phase}`,
        kind: "sourceOperation",
        sourceId: event.id,
        status,
        accepted: status !== "pending",
        acceptanceRequired: status === "pending",
        label: `${event.phase} source operation`,
        route: event.route,
        restartSafe: !blocked,
        previewAddress: null,
        externalUri: null,
        idempotencyKey: event.idempotencyKey ?? null,
        nextAction: event.nextAction ?? providerSummary?.handoff?.nextAction ?? "review-source-range-operation",
      });
    });

  return rows;
}

function compareSourceRangeClientRows(left, right) {
  return left.status.localeCompare(right.status)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

export function createSourceRangeSyncMetadata(entries = [], options = {}) {
  const fileName = options.fileName ?? entries[0]?.range?.fileName ?? "inline.aios";
  const anchors = entries.map((entry, index) => Object.freeze({
    id: `${entry.type}:${entry.name ?? "anonymous"}:${index}`,
    type: entry.type,
    name: entry.name,
    compact: entry.compact,
    shape: entry.shape,
  }));
  const shapeCounters = {};
  for (const anchor of anchors) shapeCounters[anchor.shape] = (shapeCounters[anchor.shape] ?? 0) + 1;

  return Object.freeze({
    providerId: options.providerId ?? "aios-source-range-provider",
    fileName,
    revision: options.revision,
    anchorCount: anchors.length,
    shapeCounters: freezeSortedRecord(shapeCounters),
    anchors: Object.freeze(anchors),
    syncKey: `${fileName}#${options.revision ?? "working"}#${anchors.length}`,
  });
}

export function compactSourceRange(range = {}) {
  const normalized = normalizeSourceRange(range);
  const start = `${normalized.start.line}:${normalized.start.column}`;
  const end = `${normalized.end.line}:${normalized.end.column}`;
  return normalized.start.line === normalized.end.line && normalized.start.column === normalized.end.column
    ? `${normalized.fileName}:${start}`
    : `${normalized.fileName}:${start}-${end}`;
}

function normalizePosition(position = {}, fallbackLine = 1, fallbackColumn = 1) {
  const line = finitePositiveInteger(position.line, fallbackLine);
  const column = finitePositiveInteger(position.column, fallbackColumn);
  const normalized = { line, column };
  if (position.offset !== undefined) normalized.offset = Number(position.offset);
  return Object.freeze(normalized);
}

function offsetPosition(offset = 0) {
  const safeOffset = Number.isFinite(Number(offset)) ? Math.max(0, Number(offset)) : 0;
  return Object.freeze({
    line: 1,
    column: safeOffset + 1,
    offset: safeOffset,
  });
}

function comparePositions(left, right) {
  return (left.line - right.line) || (left.column - right.column);
}

function finitePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.trunc(number)) : fallback;
}

function sourceRangeOperationalEvent(event) {
  const blockedIds = normalizeOperationalIds(event.blockedIds);
  const pendingIds = normalizeOperationalIds(event.pendingIds);
  const reviewIds = normalizeOperationalIds(event.reviewIds);
  return Object.freeze({
    id: `source-range:${event.phase}`,
    phase: event.phase,
    status: event.status ?? "unknown",
    route: event.route,
    count: Number.isFinite(Number(event.count)) ? Math.max(0, Math.trunc(Number(event.count))) : 0,
    restartSafe: event.restartSafe !== false,
    idempotencyKey: event.idempotencyKey ?? null,
    blockedIds,
    pendingIds,
    reviewIds,
    nextAction: event.nextAction,
  });
}

function normalizeOperationalIds(ids = []) {
  return Object.freeze((Array.isArray(ids) ? ids : [])
    .map((id) => String(id).trim())
    .filter(Boolean)
    .sort());
}

function createSourceRangeCapabilityFailureRows(providerContract, context) {
  return (providerContract?.capabilities ?? [])
    .filter((capability) => capability.status === "blocked" || capability.status === "degraded")
    .map((capability) => createSourceRangeFailureRow({
      id: `capability:${capability.id}`,
      kind: "providerCapability",
      targetId: capability.id,
      status: capability.status,
      route: "source-ranges/provider/capabilities",
      label: `Source capability ${capability.id}`,
      detail: capability.status === "blocked"
        ? `Required source range capability "${capability.id}" is unavailable.`
        : `Source range capability "${capability.id}" is degraded.`,
      restartSafe: capability.status !== "blocked",
      retryable: capability.required === true,
      degradedAllowed: capability.required !== true || context.degradedMode,
      nextAction: capability.nextAction ?? "repair-source-range-capability",
      idempotencySeed: providerContract.syncMetadata?.syncKey,
    }, context));
}

function createSourceRangeAnchorFailureRows(persistence, manifest, context) {
  const anchorRows = persistence?.anchors ?? manifest?.anchors ?? [];
  return anchorRows
    .filter((anchor) => (
      anchor.status === "blocked"
      || anchor.status === "changed"
      || anchor.restartSafe === false
      || (anchor.accepted === false && context.commandState.requireAcceptance)
    ))
    .map((anchor) => createSourceRangeFailureRow({
      id: `anchor:${anchor.id}`,
      kind: "sourceAnchor",
      targetId: anchor.id,
      status: anchor.status === "blocked" || anchor.restartSafe === false
        ? "blocked"
        : anchor.accepted === false && context.commandState.requireAcceptance
          ? "pending"
          : "review",
      route: "source-ranges/anchors",
      label: anchor.name ? `${anchor.type} ${anchor.name}` : `Source anchor ${anchor.id}`,
      detail: anchor.accepted === false && context.commandState.requireAcceptance
        ? `Source anchor "${anchor.id}" needs acceptance before handoff.`
        : `Source anchor "${anchor.id}" changed and needs review.`,
      restartSafe: anchor.restartSafe !== false,
      retryable: anchor.status === "blocked" || anchor.restartSafe === false,
      degradedAllowed: anchor.status !== "blocked",
      nextAction: anchor.nextAction ?? "review-source-range-anchor",
      previewAddress: anchor.compact ?? anchor.previewAddress ?? null,
      idempotencySeed: persistence?.syncKey ?? manifest?.syncKey,
    }, context));
}

function createSourceRangeBoundaryFailureRows(boundaryAudit, context) {
  return (boundaryAudit?.auditEvents ?? [])
    .filter((event) => event.status !== "ready" || event.restartSafe === false)
    .map((event) => createSourceRangeFailureRow({
      id: `boundary:${event.id}`,
      kind: "tenantBoundary",
      targetId: event.anchorId ?? event.id,
      status: event.status,
      route: boundaryAudit.restartEnvelope?.route ?? "source-ranges/boundary-summary",
      label: `Source boundary ${event.anchorId ?? event.id}`,
      detail: event.reason === "within-boundary"
        ? "Source boundary row needs review."
        : `Source boundary row is ${event.reason}.`,
      restartSafe: event.restartSafe !== false,
      retryable: event.status === "blocked",
      degradedAllowed: false,
      nextAction: event.nextAction ?? "repair-source-range-tenant-boundary",
      previewAddress: event.previewAddress ?? null,
      idempotencySeed: boundaryAudit.syncKey,
    }, context));
}

function createSourceRangeTimelineFailureRows(timeline, context) {
  return (timeline?.events ?? [])
    .filter((event) => event.status !== "ready" && event.status !== "idle" && event.status !== "unbound")
    .map((event) => createSourceRangeFailureRow({
      id: `timeline:${event.phase}`,
      kind: "operationalTimeline",
      targetId: event.phase,
      status: event.status,
      route: event.route,
      label: `Source ${event.phase}`,
      detail: `${event.count} source range ${event.phase} item(s) need recovery.`,
      restartSafe: event.restartSafe,
      retryable: event.status === "blocked" || event.status === "pending",
      degradedAllowed: event.status === "review" || event.status === "degraded",
      nextAction: event.nextAction,
      blockedIds: event.blockedIds,
      pendingIds: event.pendingIds,
      reviewIds: event.reviewIds,
      idempotencySeed: event.idempotencyKey,
    }, context));
}

function createSourceRangeMailchimpFailureRows(sourceAnchorHandoff, context) {
  return (sourceAnchorHandoff?.operationAnchors ?? [])
    .filter((anchor) => anchor.status !== "ready" || anchor.restartSafe === false)
    .map((anchor) => createSourceRangeFailureRow({
      id: `mailchimp-source:${anchor.operationId}`,
      kind: "mailchimpSourceAnchor",
      targetId: anchor.operationId,
      status: anchor.status,
      route: sourceAnchorHandoff.restartEnvelope?.route ?? "mailchimp/source-anchor/handoff",
      label: `Mailchimp source anchor ${anchor.operationId}`,
      detail: anchor.previewAddress
        ? `Mailchimp operation "${anchor.operationId}" is bound to ${anchor.previewAddress}.`
        : `Mailchimp operation "${anchor.operationId}" is missing a source anchor.`,
      restartSafe: sourceAnchorHandoff.restartSafe !== false && anchor.status !== "blocked",
      retryable: anchor.status === "blocked" || anchor.status === "pending",
      degradedAllowed: false,
      nextAction: anchor.nextAction ?? sourceAnchorHandoff.restartEnvelope?.nextAction,
      previewAddress: anchor.previewAddress ?? null,
      idempotencySeed: sourceAnchorHandoff.syncKey,
    }, context));
}

function createSourceRangeReleaseFailureRows(releasePacket, context) {
  if (!releasePacket || releasePacket.status === "ready" || releasePacket.status === "idle") return [];
  return [createSourceRangeFailureRow({
    id: "release:source-range",
    kind: "sourceRelease",
    targetId: releasePacket.syncKey ?? "source-release",
    status: releasePacket.status,
    route: releasePacket.restartEnvelope?.route ?? "source-ranges/release",
    label: "Source range release",
    detail: `${releasePacket.anchors?.length ?? 0} source range release anchor(s) are not fully settled.`,
    restartSafe: releasePacket.restartSafe !== false,
    retryable: releasePacket.status === "blocked" || releasePacket.status === "pending",
    degradedAllowed: releasePacket.status === "review",
    nextAction: releasePacket.restartEnvelope?.nextAction ?? "resume-source-range-release",
    blockedIds: releasePacket.restartEnvelope?.blockedAnchorIds,
    pendingIds: releasePacket.restartEnvelope?.pendingAnchorIds,
    idempotencySeed: releasePacket.syncKey,
  }, context)];
}

function createSourceRangeFailureRow(row, context) {
  const command = context.commandState.byId.get(row.id)
    ?? context.commandState.byId.get(row.targetId)
    ?? null;
  const attempts = normalizeRecoveryAttempt(command?.attempts ?? command?.attempt ?? context.commandState.attemptById.get(row.id) ?? 0);
  const exhausted = row.retryable && attempts >= context.maxAttempts;
  const failed = command?.status === "failed" || context.commandState.failed.has(row.id) || context.commandState.failed.has(row.targetId);
  const completed = command?.status === "completed" || context.commandState.completed.has(row.id) || context.commandState.completed.has(row.targetId);
  const queued = command?.status === "queued" || context.commandState.queued.has(row.id) || context.commandState.queued.has(row.targetId);
  const status = failed || exhausted
    ? "blocked"
    : completed
      ? "ready"
      : queued
        ? "pending"
        : normalizeSourceRangeRecoveryStatus(row.status);
  const retryAfterSeconds = status === "pending" || (row.retryable && status === "blocked" && !exhausted)
    ? normalizeRecoveryBackoffSeconds(command?.retryAfterSeconds ?? (context.baseDelaySeconds * (2 ** attempts)))
    : 0;

  return Object.freeze({
    id: row.id,
    kind: row.kind,
    targetId: row.targetId,
    status,
    sourceStatus: row.status,
    route: row.route,
    label: row.label,
    detail: row.detail,
    previewAddress: row.previewAddress ?? null,
    restartSafe: row.restartSafe !== false && !failed && (!exhausted || row.degradedAllowed),
    retryable: row.retryable === true && !completed,
    attempts,
    maxAttempts: context.maxAttempts,
    exhausted,
    degradedAllowed: row.degradedAllowed === true,
    retryAfterSeconds,
    blockedIds: Object.freeze(normalizeOperationalIds(row.blockedIds)),
    pendingIds: Object.freeze(normalizeOperationalIds(row.pendingIds)),
    reviewIds: Object.freeze(normalizeOperationalIds(row.reviewIds)),
    idempotencyKey: [
      row.idempotencySeed ?? context.fileName,
      row.id,
      status,
      attempts,
      context.revision,
    ].join(":"),
    nextAction: completed
      ? "retain-source-range-recovery-row"
      : exhausted
        ? row.degradedAllowed && context.degradedMode
          ? "enter-source-range-degraded-mode"
          : "escalate-source-range-recovery"
        : queued || status === "pending"
          ? row.nextAction ?? "run-source-range-recovery-command"
          : status === "review" || status === "degraded"
            ? row.nextAction ?? "review-source-range-recovery"
            : row.nextAction ?? "repair-source-range-failure",
  });
}

function dedupeSourceRangeFailureRows(rows) {
  const byId = new Map();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing || sourceRangeFailureStatusOrder(row.status) < sourceRangeFailureStatusOrder(existing.status)) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()];
}

function compareSourceRangeFailureRows(left, right) {
  return sourceRangeFailureStatusOrder(left.status) - sourceRangeFailureStatusOrder(right.status)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

function sourceRangeFailureStatusOrder(status) {
  return {
    blocked: 0,
    pending: 1,
    degraded: 2,
    review: 3,
    ready: 4,
  }[status] ?? 5;
}

function normalizeSourceRangeRecoveryStatus(status) {
  if (status === "ready" || status === "idle") return "ready";
  if (status === "pending" || status === "needsAcceptance") return "pending";
  if (status === "blocked" || status === "disabled" || status === "failed") return "blocked";
  if (status === "degraded") return "degraded";
  return "review";
}

function normalizeSourceRangeRecoveryCommandState(options = {}) {
  const commands = Array.isArray(options.sourceRangeRecoveryCommands)
    ? options.sourceRangeRecoveryCommands
    : Array.isArray(options.recoveryCommands)
      ? options.recoveryCommands
      : [];
  const byId = new Map(commands
    .filter((command) => command?.id)
    .map((command) => [String(command.id), command]));
  return Object.freeze({
    byId,
    queued: new Set(normalizeOperationalIds(options.queuedSourceRangeRecoveryIds ?? options.queuedRecoveryIds)),
    completed: new Set(normalizeOperationalIds(options.completedSourceRangeRecoveryIds ?? options.completedRecoveryIds)),
    failed: new Set(normalizeOperationalIds(options.failedSourceRangeRecoveryIds ?? options.failedRecoveryIds)),
    attemptById: new Map(Object.entries(options.sourceRangeAttemptByRecoveryId ?? options.attemptByRecoveryId ?? {})
      .map(([id, attempt]) => [String(id), normalizeRecoveryAttempt(attempt)])),
    requireAcceptance: options.requireSourceAnchorAcceptance !== false,
  });
}

function createSourceRangeRecoveryCommandExportRow(row = {}, context = {}) {
  const commandId = `source-range-recovery:${row.id}`;
  const requested = context.requested.has(row.id) || context.requested.has(commandId);
  const completed = context.completed.has(row.id) || context.completed.has(commandId);
  const failed = context.failed.has(row.id) || context.failed.has(commandId);
  const accepted = context.accepted.has(row.id) || context.accepted.has(commandId);
  const intent = selectSourceRangeRecoveryCommandIntent(row, context);
  const blocked = failed
    || row.exhausted === true
    || (row.status === "blocked" && row.degradedAllowed !== true)
    || row.restartSafe === false;
  const pendingAcceptance = context.requireAcceptance && !accepted && intent !== "retain";
  const status = blocked
    ? "blocked"
    : completed
      ? "ready"
      : requested || row.status === "pending" || pendingAcceptance
        ? "pending"
        : row.status === "degraded"
          ? "review"
          : normalizeSourceRangeRecoveryStatus(row.status);

  return Object.freeze({
    id: commandId,
    commandId,
    recoveryRowId: row.id,
    targetId: row.targetId ?? null,
    targetKind: row.kind ?? "sourceRangeRecovery",
    status,
    sourceStatus: row.status ?? "unknown",
    intent,
    route: row.route ?? context.state.restartEnvelope?.route ?? "source-ranges/failure-recovery",
    accepted,
    completed,
    requested,
    failed,
    restartSafe: status !== "blocked" && row.restartSafe !== false,
    retryable: row.retryable === true,
    attempts: row.attempts ?? 0,
    maxAttempts: row.maxAttempts ?? 0,
    retryAfterSeconds: row.retryAfterSeconds ?? null,
    degradedAllowed: row.degradedAllowed === true,
    previewAddress: row.previewAddress ?? null,
    idempotencyKey: [
      context.state.syncKey ?? "source-range-recovery",
      row.id,
      intent,
      status,
      row.attempts ?? 0,
    ].join(":"),
    nextAction: selectSourceRangeRecoveryCommandNextAction(row, {
      status,
      intent,
      pendingAcceptance,
    }),
  });
}

function selectSourceRangeRecoveryCommandIntent(row = {}, context = {}) {
  if (row.status === "ready") return "retain";
  if (row.status === "degraded" || (context.state.degradedMode && row.degradedAllowed)) return "degraded";
  if (row.retryable && row.exhausted !== true) return "retry";
  if (row.restartSafe === false) return "repair";
  if (row.status === "pending") return "accept";
  return "review";
}

function selectSourceRangeRecoveryCommandNextAction(row = {}, context = {}) {
  if (context.status === "blocked") return row.nextAction ?? "repair-source-range-recovery-command";
  if (context.pendingAcceptance) return `accept-source-range-recovery-command:${row.id}`;
  if (context.intent === "retry") return row.nextAction ?? `retry-source-range-recovery:${row.id}`;
  if (context.intent === "degraded") return row.nextAction ?? `review-source-range-degraded-recovery:${row.id}`;
  if (context.intent === "retain") return `retain-source-range-recovery-command:${row.id}`;
  return row.nextAction ?? `review-source-range-recovery-command:${row.id}`;
}

function createSourceRangeRecoveryDigestRows(recoveryState = {}, commandExport = {}, context = {}) {
  const recoveryRows = (recoveryState.rows ?? []).map((row) => {
    const acknowledged = context.acknowledged.has(row.id) || context.acknowledged.has(`recovery:${row.id}`);
    const requiresAck = context.requireAcknowledgement && row.status !== "ready";
    return Object.freeze({
      id: `source-recovery-digest:${row.id}`,
      sourceRowId: row.id,
      commandId: `source-range-recovery:${row.id}`,
      kind: "failureRecovery",
      status: normalizeSourceRangeDigestRowStatus(row.status, {
        blocked: row.restartSafe === false || (row.status === "blocked" && row.degradedAllowed !== true),
        pending: requiresAck && !acknowledged,
        degraded: row.status === "degraded",
      }),
      sourceStatus: row.status ?? "unknown",
      targetId: row.targetId ?? null,
      targetKind: row.kind ?? "sourceRangeRecovery",
      route: row.route ?? recoveryState.restartEnvelope?.route ?? "source-ranges/failure-recovery",
      acknowledged,
      restartSafe: row.restartSafe !== false && row.exhausted !== true,
      retryable: row.retryable === true,
      degradedAllowed: row.degradedAllowed === true,
      attempts: row.attempts ?? 0,
      maxAttempts: row.maxAttempts ?? 0,
      retryAfterSeconds: row.retryAfterSeconds ?? null,
      previewAddress: row.previewAddress ?? null,
      idempotencyKey: [
        recoveryState.syncKey ?? "source-range-recovery",
        row.id,
        row.status ?? "unknown",
        acknowledged ? "ack" : "unack",
      ].join(":"),
      nextAction: row.restartSafe === false || row.exhausted === true
        ? row.nextAction ?? "repair-source-range-recovery-row"
        : requiresAck && !acknowledged
          ? "acknowledge-source-range-recovery-row"
          : row.nextAction ?? "retain-source-range-recovery-row",
    });
  });
  const commandRows = (commandExport.commands ?? []).map((command) => {
    const acknowledged = context.acknowledged.has(command.commandId) || context.acknowledged.has(command.id);
    const requiresAck = context.requireAcknowledgement && command.status !== "ready";
    return Object.freeze({
      id: `source-recovery-digest:${command.commandId}`,
      sourceRowId: command.recoveryRowId ?? null,
      commandId: command.commandId,
      kind: "commandSettlement",
      status: normalizeSourceRangeDigestRowStatus(command.status, {
        blocked: command.restartSafe === false || command.failed === true,
        pending: requiresAck && !acknowledged,
        degraded: command.intent === "degraded",
      }),
      sourceStatus: command.sourceStatus ?? command.status ?? "unknown",
      targetId: command.targetId ?? null,
      targetKind: command.targetKind ?? "sourceRangeRecovery",
      route: command.route ?? commandExport.restartEnvelope?.route ?? "source-ranges/recovery-commands/export",
      acknowledged,
      restartSafe: command.restartSafe !== false,
      retryable: command.retryable === true || command.intent === "retry",
      degradedAllowed: command.degradedAllowed === true || command.intent === "degraded",
      attempts: command.attempts ?? 0,
      maxAttempts: command.maxAttempts ?? 0,
      retryAfterSeconds: command.retryAfterSeconds ?? null,
      previewAddress: command.previewAddress ?? null,
      idempotencyKey: [
        commandExport.syncKey ?? "source-range-recovery-command",
        command.commandId,
        command.status ?? "unknown",
        command.intent ?? "retain",
        acknowledged ? "ack" : "unack",
      ].join(":"),
      nextAction: command.restartSafe === false || command.failed === true
        ? command.nextAction ?? "repair-source-range-recovery-command"
        : requiresAck && !acknowledged
          ? "acknowledge-source-range-recovery-command"
          : command.nextAction ?? "retain-source-range-recovery-command",
    });
  });
  return dedupeSourceRangeRecoveryDigestRows([...recoveryRows, ...commandRows]);
}

function normalizeSourceRangeDigestRowStatus(status, flags = {}) {
  if (flags.blocked) return "blocked";
  if (flags.pending) return "pending";
  if (flags.degraded) return "review";
  return normalizeSourceRangeRecoveryStatus(status);
}

function dedupeSourceRangeRecoveryDigestRows(rows = []) {
  const byId = new Map();
  for (const row of rows) {
    const previous = byId.get(row.id);
    if (!previous || sourceRangeDigestStatusOrder(row.status) < sourceRangeDigestStatusOrder(previous.status)) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()];
}

function compareSourceRangeRecoveryDigestRows(left, right) {
  return sourceRangeDigestStatusOrder(left.status) - sourceRangeDigestStatusOrder(right.status)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

function sourceRangeDigestStatusOrder(status) {
  return {
    blocked: 0,
    pending: 1,
    review: 2,
    degraded: 2,
    ready: 3,
  }[status] ?? 4;
}

function compareSourceRangeRecoveryCommandRows(left, right) {
  return sourceRangeRecoveryCommandStatusOrder(left.status) - sourceRangeRecoveryCommandStatusOrder(right.status)
    || left.intent.localeCompare(right.intent)
    || left.commandId.localeCompare(right.commandId);
}

function sourceRangeRecoveryCommandStatusOrder(status) {
  return {
    blocked: 0,
    pending: 1,
    review: 2,
    ready: 3,
    idle: 4,
  }[status] ?? 5;
}

function normalizeRecoveryAttempt(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

function normalizeRecoveryAttemptLimit(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : 3;
}

function normalizeRecoveryBackoffSeconds(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : 30;
}

function createExternalSourceRangeHandoff(entries, capabilities, options) {
  const capabilityStatuses = Object.fromEntries(capabilities.map((capability) => [capability.id, capability.status]));
  const canUseExternalUri = capabilityStatuses.externalUri === "ready";
  const canHighlight = capabilityStatuses.highlight === "ready";

  return Object.freeze({
    status: Object.values(capabilityStatuses).includes("blocked") ? "blocked" : "ready",
    syncKey: options.syncMetadata.syncKey,
    providerId: options.syncMetadata.providerId,
    ranges: Object.freeze(entries.map((entry) => Object.freeze({
      type: entry.type,
      name: entry.name,
      previewAddress: entry.compact,
      highlight: canHighlight ? entry.handoff : null,
      externalUri: canUseExternalUri
        ? `${String(options.externalBaseUri).replace(/\/$/, "")}/${encodeURIComponent(entry.compact)}`
        : null,
    }))),
    nextAction: canHighlight
      ? canUseExternalUri ? "publish-source-range-handoff" : "publish-local-source-range-handoff"
      : "repair-source-range-index",
  });
}

function normalizeCapabilityList(capabilities) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return Object.keys(AIOS_SOURCE_RANGE_PROVIDER_CAPABILITIES);
  }
  return capabilities
    .map((capability) => String(capability).trim())
    .filter((capability) => AIOS_SOURCE_RANGE_PROVIDER_CAPABILITIES[capability]);
}

function normalizePreviousSourceAnchors(previousAnchors) {
  const entries = Array.isArray(previousAnchors)
    ? previousAnchors
    : previousAnchors && typeof previousAnchors === "object"
      ? Object.values(previousAnchors)
      : [];
  return new Map(entries
    .filter((anchor) => anchor && typeof anchor === "object" && anchor.id)
    .map((anchor) => [String(anchor.id), Object.freeze({
      id: String(anchor.id),
      compact: anchor.compact ?? null,
      shape: anchor.shape ?? null,
    })]));
}

function createStableSourceAnchorId(entry, index) {
  const name = String(entry.name ?? "anonymous").replace(/\s+/g, "-").toLowerCase();
  return `${entry.type}:${name}:${index}`;
}

function createRangeEntryByJobName(entries = []) {
  return Object.freeze(Object.fromEntries((Array.isArray(entries) ? entries : [])
    .filter((entry) => entry.type === "JobDeclaration" && entry.name)
    .map((entry) => [String(entry.name), entry])
    .sort(([left], [right]) => left.localeCompare(right))));
}

function countRangePreviewField(items = [], field) {
  const counters = {};
  for (const item of Array.isArray(items) ? items : []) {
    const key = item?.[field] ?? "unknown";
    counters[String(key)] = (counters[String(key)] ?? 0) + 1;
  }
  return counters;
}

function createSourceRangeRestoreCommands(anchors, providerContract, options = {}) {
  const requireAcceptance = options.requireAnchorAcceptance !== false;
  const providerBlocked = providerContract.status === "blocked";
  return anchors.map((anchor) => Object.freeze({
    id: `source-anchor:${anchor.id}`,
    kind: "sourceRangeAnchor",
    target: anchor.compact,
    status: providerBlocked || anchor.status === "blocked"
      ? "blocked"
      : requireAcceptance && !anchor.accepted
        ? "pending"
        : "ready",
    idempotencyKey: anchor.idempotencyKey,
    restartSafe: anchor.restartSafe,
    nextAction: providerBlocked
      ? providerContract.externalHandoff.nextAction
      : anchor.nextAction,
  })).sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id));
}

function normalizeSourceRangeBoundaryOptions(options = {}) {
  const allowedFileNames = normalizeBoundaryList(options.allowedSourceFileNames ?? options.allowedFileNames, options.fileName);
  const allowedWorkspaceIds = normalizeBoundaryList(options.allowedWorkspaceIds, options.workspaceId);
  const allowedRoles = normalizeBoundaryList(options.allowedRoles, null, ["owner", "admin", "editor", "service"]);
  const writeRoles = normalizeBoundaryList(options.writeRoles, null, ["owner", "admin", "editor", "service"]);
  const role = normalizeBoundaryValue(options.role ?? options.permissionRole ?? "service");

  return Object.freeze({
    tenantId: normalizeBoundaryValue(options.tenantId),
    workspaceId: normalizeBoundaryValue(options.workspaceId),
    role,
    permission: normalizeBoundaryValue(options.permission ?? "source:preview"),
    requireTenantBoundary: options.requireTenantBoundary !== false,
    requireAnchorAcceptance: options.requireSourceAnchorAcceptance ?? options.requireAnchorAcceptance ?? true,
    allowedFileNames,
    allowedWorkspaceIds,
    allowedRoles,
    writeRoles,
  });
}

function createSourceRangeBoundaryAuditEvent(anchor, context) {
  const boundary = context.boundary;
  const mailchimpCorrelation = context.mailchimpTenantCorrelation ?? null;
  const reasons = [];
  const fileName = String(anchor.compact ?? "").split(":")[0] || context.providerContract.fileName;
  const workspaceAllowed = !boundary.allowedWorkspaceIds.length
    || !boundary.workspaceId
    || boundary.allowedWorkspaceIds.includes(boundary.workspaceId);
  const fileAllowed = !boundary.allowedFileNames.length || boundary.allowedFileNames.includes(fileName);
  const roleAllowed = !boundary.allowedRoles.length || boundary.allowedRoles.includes(boundary.role);
  const writeAllowed = !boundary.writeRoles.length || boundary.writeRoles.includes(boundary.role);

  if (boundary.requireTenantBoundary && !boundary.tenantId) reasons.push("tenant-unbound");
  if (boundary.requireTenantBoundary && !boundary.workspaceId) reasons.push("workspace-unbound");
  if (!workspaceAllowed) reasons.push("workspace-outside-boundary");
  if (!fileAllowed) reasons.push("file-outside-boundary");
  if (!roleAllowed) reasons.push("role-not-allowed");
  if (!writeAllowed) reasons.push("role-read-only");
  if (boundary.requireAnchorAcceptance && !anchor.accepted) reasons.push("anchor-not-accepted");
  if (mailchimpCorrelation?.status === "blocked") reasons.push("mailchimp-tenant-permission-blocked");
  if (mailchimpCorrelation?.status === "pending") reasons.push("mailchimp-tenant-permission-pending");
  if (mailchimpCorrelation?.status === "review") reasons.push("mailchimp-tenant-permission-review");

  const blockedReasons = reasons.filter((reason) => ![
    "anchor-not-accepted",
    "mailchimp-tenant-permission-pending",
    "mailchimp-tenant-permission-review",
  ].includes(reason));
  const status = blockedReasons.length
    ? "blocked"
    : reasons.includes("anchor-not-accepted") || reasons.includes("mailchimp-tenant-permission-pending")
      ? "pending"
      : anchor.status === "changed" || reasons.includes("mailchimp-tenant-permission-review")
        ? "review"
        : "ready";
  const nextAction = status === "blocked"
    ? mailchimpCorrelation?.nextAction ?? "repair-source-range-tenant-boundary"
    : status === "pending"
      ? mailchimpCorrelation?.nextAction ?? "accept-source-range-anchor"
      : status === "review"
        ? mailchimpCorrelation?.nextAction ?? "review-source-range-boundary-change"
        : "retain-source-range-boundary";

  return Object.freeze({
    id: `source-boundary:${anchor.id}`,
    anchorId: anchor.id,
    status,
    fileName,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    role: boundary.role,
    previewAddress: anchor.compact,
    accepted: anchor.accepted,
    restartSafe: status !== "blocked",
    reason: reasons.join(",") || "within-boundary",
    mailchimpAuditRowId: mailchimpCorrelation?.auditRowId ?? null,
    mailchimpTenantStatus: mailchimpCorrelation?.status ?? "unbound",
    mailchimpTenantDecisionId: mailchimpCorrelation?.id ?? null,
    handoff: "source-range-boundary-audit",
    nextAction,
    idempotencyKey: [
      context.providerContract.syncMetadata.syncKey,
      anchor.id,
      boundary.tenantId ?? "tenant-unbound",
      boundary.workspaceId ?? "workspace-unbound",
      mailchimpCorrelation?.idempotencyKey ?? "mailchimp-tenant-unbound",
      context.revision,
    ].join(":"),
  });
}

function createSourceRangeMailchimpUnanchoredBoundaryEvent(row = {}, context = {}) {
  const boundary = context.boundary;
  const status = row.status === "pending" ? "pending" : row.status === "review" ? "review" : "blocked";
  return Object.freeze({
    id: `source-boundary:mailchimp-unanchored:${row.auditRowId ?? row.id}`,
    anchorId: null,
    status,
    fileName: context.providerContract.fileName,
    tenantId: row.tenantId ?? boundary.tenantId,
    workspaceId: row.workspaceId ?? boundary.workspaceId,
    role: row.role ?? boundary.role,
    previewAddress: row.previewAddress ?? null,
    accepted: row.accepted === true,
    restartSafe: status !== "blocked" && row.restartSafe !== false,
    reason: "mailchimp-tenant-decision-unanchored",
    mailchimpAuditRowId: row.auditRowId ?? null,
    mailchimpTenantStatus: row.status ?? "unknown",
    mailchimpTenantDecisionId: row.id ?? null,
    handoff: "source-range-boundary-audit",
    nextAction: row.nextAction ?? "bind-mailchimp-tenant-source-anchor",
    idempotencyKey: [
      context.providerContract.syncMetadata.syncKey,
      row.auditRowId ?? row.id ?? "mailchimp-unanchored",
      boundary.tenantId ?? "tenant-unbound",
      boundary.workspaceId ?? "workspace-unbound",
      context.revision,
    ].join(":"),
  });
}

function normalizeBoundaryList(values, fallback, defaults = []) {
  const source = Array.isArray(values) && values.length
    ? values
    : defaults.length
      ? defaults
      : fallback
        ? [fallback]
        : [];
  return Object.freeze([...new Set(source
    .map((value) => normalizeBoundaryValue(value))
    .filter(Boolean))]
    .sort());
}

function normalizeBoundaryValue(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function incrementRangeCounter(record, key) {
  const safeKey = key ?? "unknown";
  record[safeKey] = (record[safeKey] ?? 0) + 1;
}

function providerCapability(capability) {
  return Object.freeze(capability);
}

function freezeSortedRecord(record = {}) {
  return Object.freeze(Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  ));
}
