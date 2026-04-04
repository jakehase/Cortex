import { runWave1BrowserProof } from './lib/wave1-browser-proof.mjs';
import { ARTIFACT_ROOT, PROOF_PATH } from './lib/wave1-browser-foundation-plan.mjs';

const result = await runWave1BrowserProof({
  artifactRoot: ARTIFACT_ROOT,
  proofPath: PROOF_PATH,
  headless: process.env.MAILCLONE_BROWSER_HEADLESS !== 'false'
});

console.log(JSON.stringify({
  ok: result.ok,
  realBrowser: result.realBrowser,
  browserChecks: result.browserChecks,
  realBrowserChecks: result.realBrowserChecks,
  browserJourneyFamilies: result.browserJourneyFamilies,
  proofPath: PROOF_PATH
}, null, 2));
