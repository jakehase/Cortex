#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { atomicWriteAuthenticatedJson } from '../../src/authenticated-file-publication.mjs';
import { readRootBrokeredAuthorityJson } from '../../src/authority-input.mjs';

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let finalCloseMutation = null;
atomicWriteAuthenticatedJson(input.targetPath, input.record, {
  authenticate(candidate) {
    return candidate?.authenticated === true
      && candidate?.identity === input.record.identity;
  },
  crashInjector: input.crashPhase === null && input.attackFinalClose !== true
    ? null
    : (phase) => {
      if (input.crashPhase !== null && phase === input.crashPhase) {
        process.kill(process.pid, 'SIGKILL');
      }
      if (input.attackFinalClose === true
          && finalCloseMutation === null
          && phase
            === 'root_broker_after_final_confirmation_descriptor_release') {
        fs.writeFileSync(input.attackReadyPath, 'ready\n', {
          flag: 'wx',
          mode: 0o600,
        });
        const deadline = Date.now() + 10_000;
        const waitCell = new Int32Array(new SharedArrayBuffer(4));
        while (!fs.existsSync(input.attackResultPath)) {
          if (Date.now() >= deadline) {
            throw new Error('candidate final-close mutation probe timed out');
          }
          Atomics.wait(waitCell, 0, 0, 5);
        }
        finalCloseMutation = fs.readFileSync(
          input.attackResultPath,
          'utf8',
        ).trim();
        if (!new RegExp(
          `^denied:(EACCES|EPERM):uid-${input.attackUid}$`,
        ).test(finalCloseMutation)) {
          throw new Error(
            `candidate mutated root authority at final close: ${finalCloseMutation}`,
          );
        }
      }
    },
  fixtureOnly: input.productionProbe !== true,
  rootAuthorityBrokerFixture: input.productionProbe !== true,
});
if (input.forgeNonCanonical === true) {
  const authorityDirectory = path.dirname(input.targetPath);
  const objectDirectory = path.join(
    authorityDirectory,
    '.authenticated-objects',
  );
  const nonCanonicalBytes = Buffer.from(`${JSON.stringify(input.record)}\n`);
  const nonCanonicalDigest = crypto.createHash('sha256')
    .update(nonCanonicalBytes)
    .digest('hex');
  fs.chmodSync(authorityDirectory, 0o700);
  fs.chmodSync(objectDirectory, 0o700);
  fs.unlinkSync(input.targetPath);
  fs.writeFileSync(input.targetPath, nonCanonicalBytes, {
    flag: 'wx',
    mode: 0o400,
  });
  fs.writeFileSync(
    path.join(objectDirectory, `${nonCanonicalDigest}.json`),
    nonCanonicalBytes,
    { flag: 'wx', mode: 0o400 },
  );
  fs.chmodSync(objectDirectory, 0o500);
  fs.chmodSync(authorityDirectory, 0o500);
}
let consumerAliasMutated = false;
let consumerObjectMutated = false;
const loaded = readRootBrokeredAuthorityJson(
  input.targetPath,
  'root-broker regression object',
  {
    fixtureOnly: input.readerProductionProbe !== true,
    observer: input.attackConsumerAlias !== true
        && input.attackConsumerObject !== true
      ? null
      : (phase, context) => {
        if (phase !== 'before_return') {
          return;
        }
        if (input.attackConsumerAlias === true
            && !consumerAliasMutated
            && context.path === path.resolve(input.targetPath)) {
          consumerAliasMutated = true;
          const authorityDirectory = path.dirname(input.targetPath);
          const displaced = `${input.targetPath}.consumer-displaced`;
          fs.chmodSync(authorityDirectory, 0o700);
          fs.renameSync(input.targetPath, displaced);
          fs.writeFileSync(
            input.targetPath,
            `${JSON.stringify({
              ...input.record,
              identity: 'consumer-handoff-replacement',
            }, null, 2)}\n`,
            { flag: 'wx', mode: 0o400 },
          );
          fs.chmodSync(authorityDirectory, 0o500);
        }
        if (input.attackConsumerObject === true
            && !consumerObjectMutated
            && context.label.endsWith('immutable object consumer handoff')) {
          consumerObjectMutated = true;
          fs.chmodSync(context.path, 0o600);
          fs.writeFileSync(
            context.path,
            `${JSON.stringify({
              ...input.record,
              identity: 'consumer-object-replacement',
            }, null, 2)}\n`,
          );
          fs.chmodSync(context.path, 0o400);
        }
      },
    consume(record) {
      if (record.identity !== input.record.identity) {
        throw new Error('consumer received the wrong immutable object');
      }
      return input.asyncConsumer === true
        ? Promise.resolve(record.identity)
        : record.identity;
    },
  },
);
const bytes = Buffer.from(`${JSON.stringify(input.record, null, 2)}\n`);
const objectDigest = crypto.createHash('sha256').update(bytes).digest('hex');
const objectDirectory = path.join(
  path.dirname(input.targetPath),
  '.authenticated-objects',
);
const objectPath = path.join(objectDirectory, `${objectDigest}.json`);
const mode = (target) => (
  fs.statSync(target).mode & 0o7777
).toString(8).padStart(4, '0');
fs.writeFileSync(input.resultPath, `${JSON.stringify({
  objectDirectoryMode: mode(objectDirectory),
  objectMode: mode(objectPath),
  consumerAliasMutated,
  consumerObjectMutated,
  consumedIdentity: loaded.consumed,
  consumedUnderPinnedDescriptor: loaded.consumedUnderPinnedDescriptor,
  finalCloseMutation,
  parentMode: mode(path.dirname(input.targetPath)),
  record: loaded.record,
  stagingEntries: [
    ...fs.readdirSync(path.dirname(input.targetPath)),
    ...fs.readdirSync(objectDirectory),
  ].filter((name) => name.includes('.root-publish-')),
  targetMode: mode(input.targetPath),
})}\n`, { flag: 'wx', mode: 0o600 });
