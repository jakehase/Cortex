import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const AIOS_PROVIDER_POLICY_SCHEMA = "aios.provider-read-compute-policy.v1";
export const AIOS_PROVIDER_ACCESS_SCHEMA = "aios.provider-access.v1";
export const AIOS_PROVIDER_RESULT_SCHEMA = "aios.provider-result.v1";
export const AIOS_PROVIDER_OPERATIONS = Object.freeze(["read", "compute"]);
export const AIOS_PROVIDER_RESULT_CONTRACTS = Object.freeze(["cortex.oracle-chat.v1"]);

const PROVIDER_RESULT_CONTRACTS = new Set(AIOS_PROVIDER_RESULT_CONTRACTS);
export const AIOS_PROVIDER_POLICY_AUTHORITY = "aios.kernel.provider-policy.v1";

// This is the digest of the reviewed, checked-in kernel policy after normalization.
// A job-authored capability may select an operation from that policy, but it cannot
// turn an arbitrary origin/path into runtime authority. Policy changes therefore
// require an explicit source review that updates this pin.
export const AIOS_TRUSTED_PROVIDER_POLICY_DIGESTS = Object.freeze([
  "5ccc9b5c368810ed68fa4b2dc62a8d96a771c28401acc3b9c76953dfbdf937a3",
]);

const PROVIDER_SYSCALLS = Object.freeze({
  "provider.read": "read",
  "provider.compute": "compute",
});

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableClone(value[key])]));
  }
  return value;
}

function sha256(value) {
  const text = typeof value === "string" ? value : JSON.stringify(stableClone(value));
  return createHash("sha256").update(text).digest("hex");
}

function cleanToken(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(text) ? text : fallback;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(number)));
}

function providerError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function normalizeOperation(providerId, operationName, operation = {}) {
  const capability = String(operation.capability ?? `provider.${providerId}.${operationName}`).trim();
  const method = String(operation.method ?? "POST").trim().toUpperCase();
  const path = String(operation.path ?? "").trim();
  if (method !== "POST") {
    throw providerError("AIOS_PROVIDER_TRANSPORT_NOT_ALLOWED", `Provider ${providerId} ${operationName} must use POST.`, { providerId, operationName, method });
  }
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw providerError("AIOS_PROVIDER_PATH_INVALID", `Provider ${providerId} ${operationName} requires an origin-relative path.`, { providerId, operationName, path });
  }
  const resultContract = String(operation.resultContract ?? "").trim() || null;
  if (resultContract && !PROVIDER_RESULT_CONTRACTS.has(resultContract)) {
    throw providerError("AIOS_PROVIDER_RESULT_CONTRACT_INVALID", `Provider ${providerId} ${operationName} has an unsupported result contract.`, { providerId, operationName, resultContract });
  }
  if (resultContract === "cortex.oracle-chat.v1" && operationName !== "compute") {
    throw providerError("AIOS_PROVIDER_RESULT_CONTRACT_INVALID", "The Cortex Oracle result contract is valid only for compute operations.", { providerId, operationName, resultContract });
  }
  return Object.freeze({
    enabled: operation.enabled !== false,
    capability,
    method,
    path,
    resultContract,
    allowedModels: Object.freeze((Array.isArray(operation.allowedModels) ? operation.allowedModels : []).map((model) => String(model).trim()).filter(Boolean)),
    allowedResponseModes: Object.freeze((Array.isArray(operation.allowedResponseModes) ? operation.allowedResponseModes : []).map((mode) => String(mode).trim()).filter(Boolean)),
  });
}

export function normalizeProviderPolicy(input = {}) {
  if (input.schemaVersion && input.schemaVersion !== AIOS_PROVIDER_POLICY_SCHEMA) {
    throw providerError("AIOS_PROVIDER_POLICY_SCHEMA_INVALID", `Expected ${AIOS_PROVIDER_POLICY_SCHEMA}.`, { actual: input.schemaVersion });
  }
  if (input.resultStorageExternalWrites === true) {
    throw providerError("AIOS_PROVIDER_EXTERNAL_WRITES_FORBIDDEN", "Provider read/compute result storage cannot enable external writes.");
  }
  if (input.runtimeReplacement === true) {
    throw providerError("AIOS_PROVIDER_RUNTIME_REPLACEMENT_FORBIDDEN", "Provider read/compute policy cannot enable runtime replacement.");
  }
  if (input.outputBoundary && input.outputBoundary !== "internal-artifact-only") {
    throw providerError("AIOS_PROVIDER_OUTPUT_BOUNDARY_INVALID", "Provider outputs must use the internal-artifact-only boundary.");
  }
  const providers = {};
  for (const [rawProviderId, rawProvider] of Object.entries(input.providers ?? {})) {
    const providerId = cleanToken(rawProviderId);
    if (!providerId || !rawProvider || typeof rawProvider !== "object") continue;
    const operations = {};
    for (const operationName of AIOS_PROVIDER_OPERATIONS) {
      if (rawProvider.operations?.[operationName]) {
        operations[operationName] = normalizeOperation(providerId, operationName, rawProvider.operations[operationName]);
      }
    }
    providers[providerId] = Object.freeze({
      enabled: rawProvider.enabled !== false,
      transport: String(rawProvider.transport ?? "http-json"),
      baseUrl: String(rawProvider.baseUrl ?? "").trim(),
      allowLoopbackHttp: rawProvider.allowLoopbackHttp === true,
      timeoutMs: boundedInteger(rawProvider.timeoutMs, 30_000, 100, 120_000),
      maxRequestBytes: boundedInteger(rawProvider.maxRequestBytes, 65_536, 1_024, 1_048_576),
      maxResponseBytes: boundedInteger(rawProvider.maxResponseBytes, 1_048_576, 1_024, 10_485_760),
      operations: Object.freeze(operations),
    });
    if (providers[providerId].transport !== "http-json") {
      throw providerError("AIOS_PROVIDER_TRANSPORT_NOT_ALLOWED", `Provider ${providerId} must use http-json transport.`, { providerId, transport: providers[providerId].transport });
    }
    for (const [operationName, operation] of Object.entries(providers[providerId].operations)) {
      if (providers[providerId].enabled && operation.enabled) assertEndpoint(providerId, providers[providerId], operationName, operation);
    }
  }

  const externalTransportWrites = input.enabled === true && Object.values(providers).some((provider) => (
    provider.enabled && Object.values(provider.operations).some((operation) => operation.enabled && operation.method === "POST")
  ));
  return Object.freeze({
    schemaVersion: AIOS_PROVIDER_POLICY_SCHEMA,
    enabled: input.enabled === true,
    mode: "capability-gated-read-compute",
    outputBoundary: "internal-artifact-only",
    externalWrites: externalTransportWrites,
    externalTransportEffect: externalTransportWrites ? "network-post" : "none",
    resultStorageExternalWrites: false,
    remoteSideEffects: externalTransportWrites ? "not_observable" : "none",
    runtimeReplacement: false,
    providers: Object.freeze(providers),
  });
}

export function providerPolicyDigest(policy = {}) {
  return sha256(normalizeProviderPolicy(policy));
}

export function providerPolicyTrust(policy = {}) {
  const digest = providerPolicyDigest(policy);
  return Object.freeze({
    authority: AIOS_PROVIDER_POLICY_AUTHORITY,
    digest,
    trusted: AIOS_TRUSTED_PROVIDER_POLICY_DIGESTS.includes(digest),
  });
}

export function providerOperationFromSyscall(op = "") {
  return PROVIDER_SYSCALLS[String(op)] ?? null;
}

export function providerCapabilityName(providerId, operation) {
  return `provider.${providerId}.${operation}`;
}

export function buildProviderAccessContract({ policy = {}, capabilities = [], adapters = [], syscalls = [], tenantId = "default", workspaceId = "default" } = {}) {
  const normalized = normalizeProviderPolicy(policy);
  const policyTrust = providerPolicyTrust(normalized);
  const capabilityRows = capabilities.map((capability) => ({
    name: String(capability.name ?? ""),
    scope: String(capability.scope ?? ""),
    boundary: String(capability.boundary ?? "internal"),
  }));
  const grants = [];
  const violations = [];

  const runtimeAdapters = adapters.length > 0
    ? adapters
    : syscalls.map((syscall) => ({ adapter: syscall.op, input: syscall.args ?? {} }));
  for (const adapter of runtimeAdapters) {
    const operation = providerOperationFromSyscall(adapter.adapter);
    if (!operation) continue;
    const providerId = cleanToken(adapter.input?.provider);
    const provider = normalized.providers[providerId];
    const operationPolicy = provider?.operations?.[operation];
    const capability = operationPolicy?.capability ?? providerCapabilityName(providerId || "unknown", operation);
    const declaration = capabilityRows.find((row) => row.name === capability);

    if (!normalized.enabled) violations.push({ code: "AIOS_PROVIDER_POLICY_DISABLED", provider: providerId, operation });
    if (!policyTrust.trusted) {
      violations.push({
        code: "AIOS_PROVIDER_POLICY_NOT_TRUSTED",
        provider: providerId || null,
        operation,
        policyAuthority: policyTrust.authority,
        policyDigest: policyTrust.digest,
      });
    }
    if (!providerId) violations.push({ code: "AIOS_PROVIDER_ID_REQUIRED", provider: null, operation });
    if (!provider?.enabled) violations.push({ code: "AIOS_PROVIDER_NOT_ALLOWED", provider: providerId || null, operation });
    if (!operationPolicy?.enabled) violations.push({ code: "AIOS_PROVIDER_OPERATION_NOT_ALLOWED", provider: providerId || null, operation });
    if (!declaration) violations.push({ code: "AIOS_PROVIDER_CAPABILITY_REQUIRED", provider: providerId || null, operation, capability });
    if (declaration && (declaration.scope !== operation || declaration.boundary !== "external")) {
      violations.push({
        code: "AIOS_PROVIDER_CAPABILITY_BOUNDARY_INVALID",
        provider: providerId,
        operation,
        capability,
        expectedScope: operation,
        expectedBoundary: "external",
      });
    }
    if (provider?.transport !== "http-json") {
      violations.push({ code: "AIOS_PROVIDER_TRANSPORT_NOT_ALLOWED", provider: providerId || null, operation, transport: provider?.transport ?? null });
    }
    if (policyTrust.trusted && provider?.enabled && operationPolicy?.enabled && declaration?.scope === operation && declaration?.boundary === "external" && provider.transport === "http-json") {
      grants.push(Object.freeze({
        provider: providerId,
        operation,
        syscall: adapter.adapter,
        capability,
        method: operationPolicy.method,
        path: operationPolicy.path,
        outputBoundary: normalized.outputBoundary,
        externalWrites: true,
        externalTransportEffect: "network-post",
        resultStorageExternalWrites: false,
        remoteSideEffects: "not_observable",
      }));
    }
  }

  const uniqueViolations = [...new Map(violations.map((entry) => [JSON.stringify(stableClone(entry)), entry])).values()];
  return Object.freeze({
    schemaVersion: AIOS_PROVIDER_ACCESS_SCHEMA,
    ok: uniqueViolations.length === 0,
    mode: normalized.mode,
    tenantId: String(tenantId),
    workspaceId: String(workspaceId),
    policyAuthority: policyTrust.authority,
    policyTrusted: policyTrust.trusted,
    policyDigest: policyTrust.digest,
    outputBoundary: normalized.outputBoundary,
    externalWrites: grants.length > 0,
    externalTransportEffect: grants.length > 0 ? "network-post" : "none",
    resultStorageExternalWrites: false,
    remoteSideEffects: grants.length > 0 ? "not_observable" : "none",
    runtimeReplacement: false,
    grants: Object.freeze(grants),
    violations: Object.freeze(uniqueViolations.map((entry) => Object.freeze(entry))),
  });
}

function isLoopback(hostname) {
  const host = String(hostname ?? "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function assertEndpoint(providerId, provider, operation, operationPolicy) {
  let base;
  let endpoint;
  try {
    base = new URL(provider.baseUrl);
    endpoint = new URL(operationPolicy.path, base);
  } catch {
    throw providerError("AIOS_PROVIDER_ENDPOINT_INVALID", `Provider ${providerId} ${operation} has an invalid endpoint policy.`);
  }
  if (endpoint.origin !== base.origin) {
    throw providerError("AIOS_PROVIDER_ORIGIN_ESCAPE", `Provider ${providerId} ${operation} endpoint escapes the configured origin.`);
  }
  if (base.username || base.password || endpoint.username || endpoint.password) {
    throw providerError("AIOS_PROVIDER_ENDPOINT_CREDENTIALS_FORBIDDEN", `Provider ${providerId} ${operation} endpoint cannot embed credentials.`);
  }
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && provider.allowLoopbackHttp && isLoopback(endpoint.hostname))) {
    throw providerError("AIOS_PROVIDER_INSECURE_ENDPOINT", `Provider ${providerId} ${operation} requires HTTPS or explicitly allowed loopback HTTP.`);
  }
  return endpoint;
}

function providerPayload(operation, args = {}) {
  const omitted = new Set(["provider"]);
  const allowed = operation === "read"
    ? new Set(["provider", "query", "n_results"])
    : new Set(["provider", "prompt", "model", "response_mode"]);
  const unknown = Object.keys(args).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw providerError("AIOS_PROVIDER_ARGUMENT_NOT_ALLOWED", `Provider ${operation} received unsupported arguments: ${unknown.join(", ")}.`, { operation, unknown });
  }
  const payload = Object.fromEntries(Object.entries(args).filter(([key]) => !omitted.has(key)));
  const requiredText = operation === "read" ? payload.query : payload.prompt;
  if (typeof requiredText !== "string" || !requiredText.trim()) {
    throw providerError("AIOS_PROVIDER_ARGUMENT_REQUIRED", `Provider ${operation} requires a non-empty ${operation === "read" ? "query" : "prompt"}.`);
  }
  if (operation === "read" && payload.n_results !== undefined) {
    payload.n_results = boundedInteger(payload.n_results, 5, 1, 50);
  }
  return payload;
}

async function responseBytes(response, maximum) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    throw new Error(`Provider response exceeds ${maximum} bytes.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maximum) throw new Error(`Provider response exceeds ${maximum} bytes.`);
  return bytes;
}

function validateCortexOracleCompletion(body, { requestedModel, allowedModels = [] } = {}) {
  const fail = (code, message, details = {}) => {
    throw providerError(code, message, details);
  };
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("AIOS_PROVIDER_RESULT_SCHEMA_INVALID", "Cortex Oracle compute requires a JSON object response.");
  }
  const response = typeof body.response === "string" ? body.response : "";
  const selectedModel = String(body.model ?? "").trim();
  const lane = String(body.lane ?? "").trim();
  const origin = String(body.origin ?? "").trim();
  if (!response.trim() || !selectedModel || !lane || !origin) {
    fail("AIOS_PROVIDER_RESULT_SCHEMA_INVALID", "Cortex Oracle completion is missing response, model, lane, or origin.");
  }
  if (selectedModel.toLowerCase() === "auto") {
    fail("AIOS_PROVIDER_RESULT_IDENTITY_MISMATCH", "Cortex Oracle completion did not resolve the model selector to an executed model.");
  }
  if (body.done !== true) {
    fail("AIOS_PROVIDER_RESULT_INCOMPLETE", "Cortex Oracle completion is not done.");
  }
  if (body.degraded !== false || body.provider_invoked !== true) {
    fail("AIOS_PROVIDER_RESULT_DEGRADED", "Cortex Oracle completion lacks confirmed non-degraded provider execution.");
  }
  const providerBackedLanes = new Set([
    "requested_tinyllama",
    "strict_contract",
    "gated_direct",
    "augmenter",
    "alive_orchestrated",
    "best_effort",
    "fallback_best_effort",
  ]);
  const providerBackedOrigins = new Set([
    "ollama_provider",
    "openclaw_subprocess",
    "bridge_backend",
    "augmenter_upstream",
    "alive_orchestration",
  ]);
  if (!providerBackedLanes.has(lane) || !providerBackedOrigins.has(origin)) {
    fail("AIOS_PROVIDER_RESULT_PROVENANCE_REJECTED", "Cortex Oracle completion came from a non-provider or synthetic lane.", { lane, origin });
  }

  const receipt = body.completion_receipt;
  const evidence = receipt?.evidence;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || receipt.version !== "cortex.oracle.completion.v1"
      || receipt.kind !== "provider_response"
      || !String(receipt.receipt_id ?? "").trim()
      || !String(receipt.source ?? "").trim()
      || !evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    fail("AIOS_PROVIDER_RESULT_RECEIPT_INVALID", "Cortex Oracle completion lacks a valid provider receipt.");
  }
  const completedAt = String(receipt.completed_at ?? "").trim();
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(completedAt) || !Number.isFinite(Date.parse(completedAt))) {
    fail("AIOS_PROVIDER_RESULT_RECEIPT_INVALID", "Cortex Oracle provider receipt has an invalid completion timestamp.");
  }
  const provider = String(evidence.provider ?? "").trim();
  const receiptModel = String(evidence.model ?? "").trim();
  const identitySource = String(evidence.identity_source ?? "").trim();
  if (!provider || !receiptModel || !identitySource || receiptModel.toLowerCase() !== selectedModel.toLowerCase()) {
    fail("AIOS_PROVIDER_RESULT_IDENTITY_MISMATCH", "Cortex Oracle provider receipt does not bind the selected provider/model.");
  }
  if (String(receipt.source).toLowerCase() !== `${provider}:${receiptModel}`.toLowerCase()) {
    fail("AIOS_PROVIDER_RESULT_IDENTITY_MISMATCH", "Cortex Oracle receipt source does not match its provider/model evidence.");
  }
  if (
    selectedModel.toLowerCase() === "tinyllama"
    && (
      lane !== "requested_tinyllama"
      || origin !== "ollama_provider"
      || provider.toLowerCase() !== "ollama"
      || identitySource !== "ollama_response"
    )
  ) {
    fail(
      "AIOS_PROVIDER_RESULT_PROVENANCE_REJECTED",
      "Cortex Oracle tinyllama completion lacks the expected Ollama execution provenance.",
      { lane, origin, provider, identitySource },
    );
  }
  const responseHash = sha256(response);
  if (![receipt.response_sha256, receipt.delivered_response_sha256].map((value) => String(value ?? "")).includes(responseHash)) {
    fail("AIOS_PROVIDER_RESULT_RECEIPT_INVALID", "Cortex Oracle provider receipt is not bound to the delivered response.");
  }
  const requested = String(requestedModel ?? "").trim();
  const normalizedAllowedModels = new Set(
    (Array.isArray(allowedModels) ? allowedModels : [])
      .map((value) => String(value).trim().toLowerCase())
      .filter((value) => value && value !== "auto"),
  );
  if (requested.toLowerCase() === "auto" && !normalizedAllowedModels.has(selectedModel.toLowerCase())) {
    fail("AIOS_PROVIDER_RESULT_MODEL_MISMATCH", "Cortex Oracle auto-selection returned a model outside the selected-model allowlist.", { requestedModel: requested, selectedModel });
  }
  if (requested && requested.toLowerCase() !== "auto" && requested.toLowerCase() !== selectedModel.toLowerCase()) {
    fail("AIOS_PROVIDER_RESULT_MODEL_MISMATCH", "Cortex Oracle selected a different model than requested.", { requestedModel: requested, selectedModel });
  }
  return Object.freeze({
    provider,
    model: selectedModel,
    lane,
    origin,
    receiptId: String(receipt.receipt_id),
    identitySource,
    responseSha256: responseHash,
  });
}

export function validateProviderResultContract(resultContract, body, context = {}) {
  if (!resultContract) return null;
  if (resultContract === "cortex.oracle-chat.v1") {
    return validateCortexOracleCompletion(body, context);
  }
  throw providerError("AIOS_PROVIDER_RESULT_CONTRACT_INVALID", "Provider result contract is not supported.", { resultContract });
}

export async function executeCapabilityGatedProviderOperation({
  policy = {},
  access = {},
  op,
  args = {},
  artifactRoot,
  processId,
  ordinal,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalized = normalizeProviderPolicy(policy);
  const policyTrust = providerPolicyTrust(normalized);
  if (!policyTrust.trusted) {
    throw providerError(
      "AIOS_PROVIDER_POLICY_NOT_TRUSTED",
      "Provider transport requires an exact reviewed kernel-policy digest.",
      {
        policyAuthority: policyTrust.authority,
        policyDigest: policyTrust.digest,
        trustedPolicyDigests: AIOS_TRUSTED_PROVIDER_POLICY_DIGESTS,
      },
    );
  }
  const operation = providerOperationFromSyscall(op);
  const providerId = cleanToken(args.provider);
  const provider = normalized.providers[providerId];
  const operationPolicy = provider?.operations?.[operation];
  const capability = operationPolicy?.capability ?? providerCapabilityName(providerId || "unknown", operation || "unknown");
  const grant = (access.grants ?? []).find((entry) => entry.provider === providerId && entry.operation === operation && entry.capability === capability);

  if (!normalized.enabled || !operation || !provider?.enabled || !operationPolicy?.enabled || !grant) {
    throw providerError("AIOS_PROVIDER_OPERATION_NOT_GRANTED", `Provider operation ${op} for ${providerId || "missing-provider"} is not capability-granted.`);
  }
  if (access.policyDigest !== policyTrust.digest) {
    throw providerError("AIOS_PROVIDER_POLICY_DIGEST_MISMATCH", "Compiled provider policy digest does not match the active runtime policy.");
  }
  if (access.externalWrites !== true || normalized.externalWrites !== true || access.outputBoundary !== "internal-artifact-only"
      || access.resultStorageExternalWrites !== false) {
    throw providerError("AIOS_PROVIDER_OUTPUT_BOUNDARY_INVALID", "Provider operation must report its external POST effect while retaining results only in internal artifacts.");
  }
  if (grant.method !== operationPolicy.method || grant.path !== operationPolicy.path || grant.externalWrites !== true
      || grant.externalTransportEffect !== "network-post" || grant.resultStorageExternalWrites !== false
      || grant.outputBoundary !== "internal-artifact-only") {
    throw providerError("AIOS_PROVIDER_GRANT_POLICY_MISMATCH", "Compiled provider grant does not match the active provider policy.");
  }
  if (operation === "compute" && operationPolicy.allowedModels.length > 0 && !operationPolicy.allowedModels.includes(String(args.model ?? ""))) {
    throw providerError("AIOS_PROVIDER_MODEL_NOT_ALLOWED", `Provider model ${String(args.model ?? "<missing>")} is not allowlisted.`, { providerId, model: args.model ?? null });
  }
  if (operation === "compute" && args.response_mode !== undefined && operationPolicy.allowedResponseModes.length > 0 && !operationPolicy.allowedResponseModes.includes(String(args.response_mode))) {
    throw providerError("AIOS_PROVIDER_RESPONSE_MODE_NOT_ALLOWED", `Provider response mode ${String(args.response_mode)} is not allowlisted.`, { providerId, responseMode: args.response_mode });
  }
  if (typeof fetchImpl !== "function") throw new Error("No provider transport is available.");

  const endpoint = assertEndpoint(providerId, provider, operation, operationPolicy);
  const payload = providerPayload(operation, args);
  const method = operationPolicy.method;
  const requestBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (requestBytes > provider.maxRequestBytes) {
    throw providerError("AIOS_PROVIDER_REQUEST_TOO_LARGE", `Provider request exceeds ${provider.maxRequestBytes} bytes.`, { providerId, operation, requestBytes });
  }
  const request = {
    method,
    headers: { accept: "application/json", "content-type": "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(provider.timeoutMs),
  };
  if (!new Set(["GET", "HEAD"]).has(method)) request.body = JSON.stringify(payload);
  const response = await fetchImpl(endpoint, request);
  if (!response.ok) throw new Error(`Provider ${providerId} ${operation} returned HTTP ${response.status}.`);
  const bytes = await responseBytes(response, provider.maxResponseBytes);
  const contentType = String(response.headers?.get?.("content-type") ?? "");
  let body;
  try {
    body = contentType.includes("json") ? JSON.parse(bytes.toString("utf8")) : bytes.toString("utf8");
  } catch {
    throw new Error(`Provider ${providerId} ${operation} returned invalid JSON.`);
  }
  const verifiedCompletion = validateProviderResultContract(operationPolicy.resultContract, body, {
    requestedModel: args.model,
    allowedModels: operationPolicy.allowedModels,
  });

  const resultDir = join(artifactRoot, "provider-results", processId);
  await mkdir(resultDir, { recursive: true });
  const resultPath = join(resultDir, `${String(ordinal).padStart(3, "0")}-${operation}.json`);
  const result = {
    schemaVersion: AIOS_PROVIDER_RESULT_SCHEMA,
    provider: providerId,
    operation,
    capability,
    observedAt: new Date().toISOString(),
    request: {
      endpoint: endpoint.toString(),
      method,
      payloadHash: sha256(payload),
    },
    response: {
      status: response.status,
      contentType: contentType || null,
      bytes: bytes.byteLength,
      body,
      bodyHash: sha256(bytes),
      resultContract: operationPolicy.resultContract,
      verifiedCompletion,
    },
    boundary: {
      output: "internal-artifact-only",
      externalWrites: true,
      externalTransportEffect: "network-post",
      resultStorageExternalWrites: false,
      remoteSideEffects: "not_observable",
      runtimeReplacement: false,
    },
  };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return Object.freeze({
    provider: providerId,
    operation,
    capability,
    resultPath,
    resultHash: sha256(result),
    responseStatus: response.status,
    responseBytes: bytes.byteLength,
    resultContract: operationPolicy.resultContract,
    selectedProvider: verifiedCompletion?.provider ?? null,
    selectedModel: verifiedCompletion?.model ?? null,
    selectedLane: verifiedCompletion?.lane ?? null,
    outputBoundary: "internal-artifact-only",
    externalWrites: true,
    externalTransportEffect: "network-post",
    resultStorageExternalWrites: false,
    remoteSideEffects: "not_observable",
  });
}
