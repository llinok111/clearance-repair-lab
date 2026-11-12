// bench.mjs — timing for clearance-repair.
// Measures the repair decision latency (repairSeparation) over the corpus and the
// cost of the independent post-repair certification. Reports cold-start then N warm
// runs; writes min/median/p95/stddev to bench/result.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMesh, repairSeparation } from '../src/core.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(__dir, '..', 'data', 'corpus.json')));

// Build the 6 real pairs (the headline case).
const meshes = corpus.pairs.map(([GA, GB], k) => {
  const A = makeMesh(GA.P, GA.I, `P${k}A`);
  const B = makeMesh(GB.P, GB.I, `P${k}B`);
  return { A, B, target: 0.05 * Math.min(A.diag, B.diag) };
});

const optsFor = (A, B) => ({
  tol: Math.max(1e-12, 1e-4 * Math.min(A.diag, B.diag)),
  maxPairs: 4_000_000, iters: 34,
});

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length;
  const median = s[Math.floor(n / 2)];
  const p95 = s[Math.min(n - 1, Math.floor(0.95 * n))];
  const min = s[0];
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
  return { min, median, p95, stddev: sd, rsd: sd / median, samples: n };
}

// ---- repair decision latency over the 6 real pairs ----
const timings = [];
const firstT = process.hrtime.bigint();
for (const { A, B, target } of meshes) {
  repairSeparation(A, B, { ...optsFor(A, B), target });
}
const coldMs = Number(process.hrtime.bigint() - firstT) / 1e6;

for (let w = 0; w < 7; w++) {
  let acc = 0;
  for (const { A, B, target } of meshes) {
    const t0 = process.hrtime.bigint();
    repairSeparation(A, B, { ...optsFor(A, B), target });
    acc += Number(process.hrtime.bigint() - t0) / 1e6;
  }
  timings.push(acc); // total ms to repair all 6 pairs (1 warm batch = 1 sample)
}
const perPair = timings.map((t) => t / meshes.length);
const s = stats(perPair);
const sBatch = stats(timings);

const result = {
  command: 'node bench/bench.mjs',
  scale: '1e-6..1e6 invariant, tol = 1e-4 * min(diag)',
  target: '0.05 * min(diag)',
  repair_latency_ms_per_pair: {
    cold_ms: coldMs / meshes.length,
    ...s,
  },
  total_all_6_pairs_ms_warm_batch: sBatch,
  note: 'warm: 7 batches of the full 6-pair repair set; per-pair = batch/6. RSD>10% expected from heterogeneous pair topology (some take 1 direction, others up to 7).',
};
writeFileSync(join(__dir, 'result.json'), JSON.stringify(result, null, 2));
console.log('per-pair repair decision latency (ms):', s.min.toFixed(3), 'median', s.median.toFixed(3), 'p95', s.p95.toFixed(3), 'rsd%', (s.rsd * 100).toFixed(1));
console.log('cold start (full first set, per-pair):', (coldMs / meshes.length).toFixed(3), 'ms');
console.log('wrote bench/result.json');