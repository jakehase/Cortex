#!/usr/bin/env node
import fs from 'node:fs';

import {
  installRetentionResumeTimer,
  persistRetentionWaitContract,
} from '../../src/phd-retention.mjs';
import {
  acquirePhdJobExclusion,
} from '../../src/phd-terminal-publication.mjs';

const [mode, inputPath] = process.argv.slice(2);

function waitForever() {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  for (;;) Atomics.wait(cell, 0, 0, 60_000);
}

try {
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (mode === 'retention-hold') {
    installRetentionResumeTimer({
      contract: input.contract,
      waitPath: input.waitPath,
      signingSecret: input.signingSecret,
      systemctl: '/fake/systemctl',
      now: input.now,
      crashInjector(phase) {
        if (phase !== input.holdPhase) return;
        fs.writeFileSync(input.readyPath, `${process.pid}\n`, { mode: 0o600 });
        waitForever();
      },
    });
  } else if (mode === 'retention-persist-hold') {
    persistRetentionWaitContract({
      contract: input.contract,
      waitPath: input.waitPath,
      signingSecret: input.signingSecret,
      persistedAt: input.persistedAt,
      crashInjector(phase) {
        if (phase !== 'before_wait_publication') return;
        fs.writeFileSync(input.readyPath, `${process.pid}\n`, { mode: 0o600 });
        waitForever();
      },
    });
  } else if (mode === 'retention-persist-contend' || mode === 'retention-persist-crash') {
    persistRetentionWaitContract({
      contract: input.contract,
      waitPath: input.waitPath,
      signingSecret: input.signingSecret,
      persistedAt: input.persistedAt,
      ...(mode === 'retention-persist-crash' ? {
        crashInjector(phase) {
          if (phase === 'after_retention_no_replace_link_before_parent_fsync') {
            process.kill(process.pid, 'SIGKILL');
          }
        },
      } : {}),
    });
  } else if (mode === 'retention-contend') {
    installRetentionResumeTimer({
      contract: input.contract,
      waitPath: input.waitPath,
      signingSecret: input.signingSecret,
      systemctl: '/fake/systemctl',
      dryRun: true,
      now: input.now,
    });
  } else if (mode === 'publication-hold' || mode === 'publication-contend') {
    const descriptor = fs.openSync(
      input.lockPath,
      fs.constants.O_RDONLY
        | (fs.constants.O_DIRECTORY || 0)
        | (fs.constants.O_NOFOLLOW || 0)
        | (fs.constants.O_CLOEXEC || 0),
    );
    const helperStat = fs.lstatSync('/usr/bin/flock');
    acquirePhdJobExclusion({
      lockPath: input.lockPath,
      descriptor,
      expectedUid: input.expectedUid,
      expectedGid: input.expectedGid,
      helperExpectedUid: helperStat.uid,
      helperExpectedGid: helperStat.gid,
    });
    if (mode === 'publication-hold') {
      fs.writeFileSync(input.readyPath, `${input.phase}:${process.pid}\n`, { mode: 0o600 });
      waitForever();
    }
    fs.closeSync(descriptor);
  } else {
    throw new Error('unknown concurrency fixture mode');
  }
  process.stdout.write('acquired\n');
} catch (error) {
  fs.writeSync(2, `${error.message}\n`);
  process.exitCode = 4;
}
