#!/usr/bin/env node
import fs from 'node:fs';

import {
  reconcilePhdTerminalPublicationJournalStages,
} from '../../src/phd-terminal-publication.mjs';

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const recovered = reconcilePhdTerminalPublicationJournalStages({
  journalPath: input.journalPath,
  quarantineRoot: input.quarantineRoot,
  jobId: input.jobId,
});
const quarantined = fs.readdirSync(input.quarantineRoot).sort().map((name) => {
  const target = `${input.quarantineRoot}/${name}`;
  return {
    name,
    symbolicLink: fs.lstatSync(target).isSymbolicLink(),
  };
});
fs.writeFileSync(input.resultPath, `${JSON.stringify({
  recovered,
  staging: fs.readdirSync(input.stagingRoot).sort(),
  quarantined,
})}\n`, {
  flag: 'wx',
  mode: 0o600,
});
