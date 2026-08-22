#!/usr/bin/env node
import fs from 'node:fs';

import {
  atomicWriteSignedControlPlaneRecord,
} from '../../src/authenticated-control-publication.mjs';
import { atomicWritePhdCampaignReport } from '../../src/phd-campaign.mjs';

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
fs.writeFileSync(input.readyPath, `${process.pid}\n`, {
  flag: 'wx',
  mode: 0o600,
});
const waitCell = new Int32Array(new SharedArrayBuffer(4));
while (!fs.existsSync(input.startPath)) Atomics.wait(waitCell, 0, 0, 5);

try {
  const options = input.crashPhase === undefined
    ? { fixtureOnly: true }
    : {
      fixtureOnly: true,
      crashInjector(phase) {
        if (phase === input.crashPhase) process.kill(process.pid, 'SIGKILL');
      },
  };
  if (input.mode === 'generic') {
    atomicWriteSignedControlPlaneRecord(
      input.targetPath,
      input.record,
      input.signingSecret,
      options,
    );
  } else if (input.mode === 'campaign') {
    atomicWritePhdCampaignReport(
      input.targetPath,
      input.report,
      input.signingSecret,
      options,
    );
  } else {
    throw new Error('unknown publication child mode');
  }
  process.stdout.write('published\n');
} catch (error) {
  fs.writeSync(2, `${error.message}\n`);
  process.exitCode = 4;
}
