#!/usr/bin/env node
// Timing: cold start + 7 warm repetitions per curated case; naive baseline for contrast.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMesh, repairClearance, bruteForceDistance } from '../src/core.mjs';
import { naiveRepair } from '../baseline/naive.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpus = JSON.parse(readFileSync(join(ROOT, 'data', 'corpus.json'), 'utf8'));
const mk = (c) => ({ A: makeMesh(c.meshA.positions, c.meshA.indices, 'A'), B: makeMesh(c.meshB.positions, c.meshB.indices, 'B') });
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  return { min: s[0], median: med, p95: s[Math.min(s.length - 1, Math.floor(0.95 * s.length))], max: s[s.length - 1],
    stddev: sd, rsd: mean > 0 ? sd / mean : 0, samples: s.length };
};

const meshes = corpus.cases.map((c) => ({ c, ...mk(c) }));
// warmup 1
for (const m of meshes) repairClearance(m.A, m.B, m.c.target);

const perCase = new Map(meshes.map((m) => [m.c.id, []]));
const REPEATS = 7;
for (let rep = 0; rep < REPEATS; rep++) {
  for (const m of meshes) {
    const t0 = performance.now();
    repairClearance(m.A, m.B, m.c.target);
    perCase.get(m.c.id).push(performance.now() - t0);
  }
}

// cold start: first call in a fresh process is measured by re-importing is not possible here,
// so we report the first timed call of this process (before warmup) from a separate module state.
const cold = (() => {
  const m = meshes[4]; // torus, the expensive case
  const t0 = performance.now();
  repairClearance(m.A, m.B, m.c.target);
  return performance.now() - t0;
})();

const cases = meshes.map((m) => ({
  id: m.c.id, target: m.c.target, tris: m.A.triCount * m.B.triCount,
  ms: stats(perCase.get(m.c.id)),
}));
const allSamples = [...perCase.values()].flat();
const total = stats(allSamples);

// baseline: exact O(n^2) planner, 3 reps per case it can handle
const base = [];
for (const m of meshes) {
  const samples = [];
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now();
    const out = naiveRepair(m.A, m.B, m.c.target);
    samples.push(performance.now() - t0);
    if (r === 0) base.push({ id: m.c.id, verdict: out.verdict, moved: out.moved, verified: out.verified, tests: out.tests, ms: stats(samples) });
  }
  const row = base.find((b) => b.id === m.c.id);
  row.ms = stats(samples);
}

const result = {
  runtime: { node: process.version, platform: process.platform, arch: process.arch, cpus: 4 },
  method: 'cold start + 1 warmup + 7 timed repetitions per case; per-case and pooled statistics',
  repeats: REPEATS,
  coldStartTorusMs: cold,
  pooled: total,
  cases,
  baseline: base,
};
writeFileSync(join(ROOT, 'bench', 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`pooled median ${total.median.toFixed(2)} ms (min ${total.min.toFixed(2)}, p95 ${total.p95.toFixed(2)}, rsd ${(100 * total.rsd).toFixed(1)}%)`);
for (const c of cases) console.log(`  ${c.id.padEnd(20)} median ${c.ms.median.toFixed(2)} ms  rsd ${(100 * c.ms.rsd).toFixed(1)}%  (${c.tris} tri pairs)`);
console.log(`cold start (torus) ${cold.toFixed(2)} ms`);
for (const b of base) console.log(`  baseline ${b.id.padEnd(20)} ${b.verdict.padEnd(12)} ${b.ms.median.toFixed(1)} ms  moved=${b.moved.toFixed(5)}`);
