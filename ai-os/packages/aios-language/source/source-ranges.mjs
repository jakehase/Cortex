import { createCatalogDiagnostic } from "./diagnostic-catalog.mjs";

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
  const auditEvents = persistence.anchors.map((anchor) => createSourceRangeBoundaryAuditEvent(anchor, {
    boundary,
    providerContract,
    revision: options.revision ?? "working",
  }));
  const blocked = auditEvents.filter((event) => event.status === "blocked");
  const review = auditEvents.filter((event) => event.status === "review");
  const pending = auditEvents.filter((event) => event.status === "pending");
  const diagnostics = blocked.map((event) => createCatalogDiagnostic("AIOS_SOURCE_RANGE", {
    message: `Source range anchor "${event.anchorId}" is outside the source boundary: ${event.reason}.`,
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
    ].join("|"),
    boundary,
    auditEvents: Object.freeze(auditEvents.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    diagnostics: Object.freeze(diagnostics),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countRangePreviewField(auditEvents, "status")),
      byRole: freezeSortedRecord(countRangePreviewField(auditEvents, "role")),
      byWorkspace: freezeSortedRecord(countRangePreviewField(auditEvents, "workspaceId")),
    }),
    recovery: Object.freeze({
      blockedAnchorIds: Object.freeze(blocked.map((event) => event.anchorId).sort()),
      pendingAnchorIds: Object.freeze(pending.map((event) => event.anchorId).sort()),
      reviewAnchorIds: Object.freeze(review.map((event) => event.anchorId).sort()),
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
  const status = providerContract?.status === "blocked" || manifest?.status === "blocked" || blockedCapabilities.length || blockedAnchors.length
    ? "blocked"
    : manifest?.status === "pending" || pendingAnchors.length || timeline.status === "pending"
      ? "pending"
      : degradedCapabilities.length || manifest?.status === "review" || timeline.status === "review"
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
      operationalEventCount: timeline.totals.eventCount,
      actionableEventCount: timeline.totals.actionableEventCount,
    }),
    capabilities: Object.freeze(capabilityRows.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    anchors: Object.freeze(anchorRows.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    externalRanges: Object.freeze(externalRows.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    recovery: Object.freeze({
      blockedCapabilityIds: Object.freeze(blockedCapabilities.map((capability) => capability.id).sort()),
      degradedCapabilityIds: Object.freeze(degradedCapabilities.map((capability) => capability.id).sort()),
      blockedAnchorIds: Object.freeze(blockedAnchors.map((anchor) => anchor.id).sort()),
      pendingAnchorIds: Object.freeze(pendingAnchors.map((anchor) => anchor.id).sort()),
      nextAction: blockedCapabilities[0]?.nextAction
        ?? blockedAnchors[0]?.nextAction
        ?? pendingAnchors[0]?.nextAction
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
      restartSafe: blockedCapabilities.length === 0 && blockedAnchors.length === 0 && timeline.restartEnvelope.restartSafe,
      idempotencyKeys: timeline.restartEnvelope.idempotencyKeys,
      nextAction: blockedCapabilities[0]?.nextAction
        ?? blockedAnchors[0]?.nextAction
        ?? pendingAnchors[0]?.nextAction
        ?? timeline.restartEnvelope.nextAction,
    }),
    timeline,
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

  const blockedReasons = reasons.filter((reason) => reason !== "anchor-not-accepted");
  const status = blockedReasons.length
    ? "blocked"
    : reasons.includes("anchor-not-accepted")
      ? "pending"
      : anchor.status === "changed"
        ? "review"
        : "ready";
  const nextAction = status === "blocked"
    ? "repair-source-range-tenant-boundary"
    : status === "pending"
      ? "accept-source-range-anchor"
      : status === "review"
        ? "review-source-range-boundary-change"
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
    handoff: "source-range-boundary-audit",
    nextAction,
    idempotencyKey: [
      context.providerContract.syncMetadata.syncKey,
      anchor.id,
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
