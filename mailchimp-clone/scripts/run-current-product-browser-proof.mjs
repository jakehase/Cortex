import { runCurrentProductBrowserProof } from './lib/current-product-browser-proof.mjs';

const result = await runCurrentProductBrowserProof({
  artifactRoot: process.argv[2] || null,
  captureScreenshots: process.env.CAPTURE_SCREENSHOTS !== '0',
  headless: process.env.HEADLESS !== '0'
});

console.log(JSON.stringify(result, null, 2));
