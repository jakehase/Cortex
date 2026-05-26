import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_MAILCHIMP_TRUTH_MARKERS = Object.freeze([
  /real Mailchimp is over 1M LOC/i,
  /nowhere near full parity/i,
  /(abundant .*remaining .*work|remaining-work matrix|remaining real product work)/i,
  /strict-gap green is not Mailchimp full parity/i
]);

const REQUIRED_ORCHESTRATION_TRUTH_MARKERS = Object.freeze([
  /abundant remaining real work/i,
  /sustained real-code throughput/i,
  /full Mailchimp parity/i
]);

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function matchingMarkers(text, markers) {
  return markers.map((marker) => ({ marker: String(marker), present: marker.test(text) }));
}

function allPresent(results) {
  return results.every((entry) => entry.present === true);
}

export function buildMailchimpCanonicalTruthPreflight({ workspaceRoot = path.resolve(process.cwd(), '..'), generatedAt = new Date().toISOString() } = {}) {
  const root = path.resolve(workspaceRoot);
  const mailchimpMemoryPath = path.join(root, 'memory', 'projects', 'mailchimp.md');
  const orchestrationMemoryPath = path.join(root, 'memory', 'projects', '100-agent-orchestration.md');
  const longTermMemoryPath = path.join(root, 'MEMORY.md');
  const mailchimpMemory = readText(mailchimpMemoryPath);
  const orchestrationMemory = readText(orchestrationMemoryPath);
  const longTermMemory = readText(longTermMemoryPath);
  const mailchimpMarkers = matchingMarkers(mailchimpMemory, REQUIRED_MAILCHIMP_TRUTH_MARKERS);
  const orchestrationMarkers = matchingMarkers(`${orchestrationMemory}\n${longTermMemory}`, REQUIRED_ORCHESTRATION_TRUTH_MARKERS);
  const localProjectMemoryOk = allPresent(mailchimpMarkers);
  const localOrchestrationMemoryOk = allPresent(orchestrationMarkers);
  const ok = localProjectMemoryOk && localOrchestrationMemoryOk;
  return {
    generatedAt,
    ok,
    project: 'mailchimp',
    memoryTruth: {
      fullCloneParityKnownIncomplete: true,
      realMailchimpScale: 'over_1m_loc',
      assumeAbundantRemainingWork: true,
      strictGapGreenIsNotFullParity: true
    },
    localProjectMemoryOk,
    localOrchestrationMemoryOk,
    sources: {
      mailchimpMemoryPath,
      orchestrationMemoryPath,
      longTermMemoryPath
    },
    markerChecks: {
      mailchimp: mailchimpMarkers,
      orchestration: orchestrationMarkers
    },
    guardrail: ok
      ? 'Mailchimp full-clone truth memory is available; scoped matrix green must not be reported as full product parity.'
      : 'Mailchimp full-clone truth memory is missing or incomplete; stop before reporting full parity and repair memory/preflight first.'
  };
}

export function writeMailchimpCanonicalTruthPreflight({ workspaceRoot, outputPath, generatedAt } = {}) {
  const payload = buildMailchimpCanonicalTruthPreflight({ workspaceRoot, generatedAt });
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  }
  return payload;
}
