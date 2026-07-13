import { updateJson } from './index.ts';

const [targetPath, worker, iterations] = process.argv.slice(2);
for (let sequence = 0; sequence < Number(iterations); sequence += 1) {
  updateJson(targetPath, { entries: [], counters: {} }, (state) => {
    state.entries.push(`${worker}:${sequence}`);
    state.counters[worker] = Number(state.counters[worker] || 0) + 1;
  });
}
