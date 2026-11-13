#!/usr/bin/env node
// Assertions. Every claim in README is produced here. Exit 0 only if all pass.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMesh, repairClearance, bruteForceDistance, translateMesh, closestPair } from '../src/core.mjs';
import { naiveRepair } from '../baseline/naive.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
const corpus = load('corpus.json'), random = load('random.json');
const mk = (c) => ({ A: makeMesh(c.meshA.positions, c.meshA.indices, 'A'), B: makeMesh(c.meshB.positions, c.meshB.indices, 'B') });

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`PASS ${name}: ${detail}`); }
  else { fail++; console.log(`FAIL ${name}: ${detail}`); }
};

/* 1-4: curated corpus */
const cur = corpus.cases.map((c, i) => {
  const { A, B } = mk(c);
  const r = repairClearance(A, B, c.target);
  const beforeBF = bruteForceDistance(A, B).lo;
  const afterBF = bruteForceDistance(A, r.meshB).lo;
  return { c, A, B, r, beforeBF, afterBF };
});
ok('6/6 curated repaired with certified interval lo >= target',
  cur.every((x) => x.r.verified), cur.map((x) => `${x.c.id}:${x.r.after.lo.toFixed(4)}>=${x.c.target}`).join(' '));
ok('6/6 after-distance confirmed by independent O(n^2) brute force',
  cur.every((x) => x.afterBF >= x.c.target - 1e-12), cur.map((x) => `${x.c.id}:${x.afterBF.toFixed(4)}`).join(' '));
ok('12/12 intervals bracket the brute-force truth (before and after)',
  cur.every((x) => x.beforeBF >= x.r.before.lo - 1e-12 && x.beforeBF <= x.r.before.hi + 1e-12
    && x.afterBF >= x.r.after.lo - 1e-12 && x.afterBF <= x.r.after.hi + 1e-12),
  cur.map((x) => `${x.c.id}:[${x.r.before.lo.toFixed(3)},${x.r.before.hi.toFixed(3)}]`).join(' '));
ok('moved >= sound lower bound on EVERY case (theorem L1)',
  cur.every((x) => x.r.moved >= x.r.lowerBound - 1e-12),
  cur.map((x) => `${x.c.id}:${x.r.moved.toFixed(4)}>=${x.r.lowerBound.toFixed(4)}`).join(' '));
const tight = cur.filter((x) => x.r.gapRatio <= 1.02).length;
ok('5/6 within 2% of the sound floor; the ring case is reported, not hidden',
  tight === 5 && cur.find((x) => x.c.id === 'torus-over-sphere').r.gapRatio > 1.1,
  `within2%=${tight}/6, torus gap=${cur.find((x) => x.c.id === 'torus-over-sphere').r.gapRatio.toFixed(4)}`);

/* 5-6: 100 random pairs */
const rnd = random.cases.map((c) => {
  const { A, B } = mk(c);
  const r = repairClearance(A, B, c.target);
  return { c, A, r, afterBF: bruteForceDistance(A, r.meshB).lo };
});
const rndOk = rnd.filter((x) => x.r.verified).length;
ok('100/100 random pairs repaired and certified', rndOk === 100, `verified=${rndOk}/100`);
ok('100/100 random repairs confirmed by brute force', rnd.every((x) => x.afterBF >= x.c.target - 1e-12),
  `min after/target = ${Math.min(...rnd.map((x) => x.afterBF / x.c.target)).toFixed(4)}`);
const gaps = rnd.map((x) => x.r.gapRatio).sort((a, b) => a - b);
ok('random gap-to-floor median <= 1.02', gaps[50] <= 1.02,
  `median=${gaps[50].toFixed(4)} p95=${gaps[95].toFixed(4)} max=${gaps[99].toFixed(4)}`);

/* 7: no false claims */
const all = [...cur, ...rnd];
const falseClaims = all.filter((x) => x.r.verified && !(x.afterBF >= x.c.target - 1e-12)).length;
ok('0 false "repaired" claims across 106 pairs', falseClaims === 0, `falseClaims=${falseClaims}`);

/* 8: interpenetration -> abstain, never a fake repair */
{
  const A = makeMesh([-1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1, -1,-1,1, 1,-1,1, 1,1,1, -1,1,1],
    [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,2,3,7,2,7,6,1,2,6,1,6,5,0,4,7,0,7,3]);
  const B = translateMesh(A, [0.5, 0, 0]);
  const r = repairClearance(A, B, 0.05);
  ok('interpenetrating pair abstains with a reason, verified=false',
    r.verified === false && r.verdict === 'abstain' && /direction|progress/.test(r.reason), `verdict=${r.verdict} reason=${r.reason}`);
}

/* 9: scale invariance */
{
  const c = corpus.cases[0];
  const base = mk(c);
  const rows = [];
  for (const s of [1e-6, 1e-3, 1, 1e3, 1e6]) {
    const A = makeMesh(Array.from(base.A.positions, (v) => v * s), base.A.indices);
    const B = makeMesh(Array.from(base.B.positions, (v) => v * s), base.B.indices);
    const r = repairClearance(A, B, c.target * s);
    rows.push({ s, verified: r.verified, steps: r.steps.length, movedOverScale: r.moved / s, gap: r.gapRatio });
  }
  const spread = Math.max(...rows.map((r) => r.movedOverScale)) / Math.min(...rows.map((r) => r.movedOverScale)) - 1;
  ok('scale 1e-6..1e6: all verified, moved/scale spread <= 1e-9, same step count',
    rows.every((r) => r.verified && r.steps === rows[0].steps) && spread <= 1e-9,
    rows.map((r) => `${r.s}:${r.movedOverScale.toFixed(9)}`).join(' ') + ` spread=${spread.toExponential(2)}`);
}

/* 10: determinism */
{
  const c = corpus.cases[1], a = mk(c), b = mk(c);
  const r1 = repairClearance(a.A, a.B, c.target), r2 = repairClearance(b.A, b.B, c.target);
  ok('two runs identical (translation, intervals, steps)',
    JSON.stringify([r1.translation, r1.before, r1.after, r1.steps.length]) === JSON.stringify([r2.translation, r2.before, r2.after, r2.steps.length]),
    `moved=${r1.moved.toFixed(12)} both`);
}

/* 11-12: baseline comparison */
{
  const rows = cur.map((x) => {
    const n = naiveRepair(x.A, x.B, x.c.target);
    const same = n.verified && Math.abs(n.moved - x.r.moved) / Math.max(x.r.moved, 1e-12) < 1e-6;
    return { id: x.c.id, n, same, moved: x.r.moved };
  });
  const contact = rows.filter((x) => x.id !== 'tetra-over-box');
  ok('naive planner returns NO direction on all 3 exact contacts (d0 = 0)',
    contact.slice(0, 3).every((x) => x.n.verdict === 'no-direction'),
    contact.slice(0, 3).map((x) => `${x.id}:${x.n.verdict}`).join(' '));
  // The naive planner uses the exact distance; the certified one only knows the interval,
  // so it must overshoot by at most the interval width. That is the honest tolerance.
  const planned = rows.filter((x) => x.n.verified);
  const explainable = cur.filter((x) => planned.some((p2) => p2.id === x.c.id))
    .every((x) => {
      const n = planned.find((p2) => p2.id === x.c.id).n;
      const slack = (x.r.before.hi - x.r.before.lo) + 2 * x.r.steps[0].delta * 0 + 2 * Math.min(1e-4 * x.A.diag, 1e-3 * x.c.target);
      return Math.abs(n.moved - x.r.moved) <= slack + 1e-12;
    });
  ok('naive translation differs from the certified one by <= interval width + 2*tol',
    planned.length >= 1 && explainable,
    planned.map((x) => `${x.id}:naive=${x.n.moved.toFixed(6)} cert=${x.moved.toFixed(6)} diff=${Math.abs(x.n.moved - x.moved).toExponential(2)}`).join(' '));
}

/* 13: budget exhaustion abstains */
{
  const c = corpus.cases[3], { A, B } = mk(c);   // positive gap: the heap is non-trivial
  const r = repairClearance(A, B, c.target, { maxPairs: 0 });
  ok('budget exhaustion abstains instead of guessing',
    r.verified === false && r.verdict === 'abstain' && r.reason === 'budget-exhausted-before', `reason=${r.reason}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
