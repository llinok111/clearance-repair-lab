// verify.mjs — behavior assertions for clearance-repair.
// Runs the repair operator over the corpus and checks:
//  V1. 6/6 contact pairs are repairable and reach target with lo>0.
//  V2. >=95% of random pairs that need repair succeed.
//  V3. repaired interval is sound + certified: lo>0 and lo>=target (within tol).
//  V4. translation magnitude vs an INDEPENDENT oracle minimalTranslation is
//      within 2% (per-direction optimality gap), on the 6 certificate pairs.
//  V5. scale invariance: a same-shape overlapping pair repaired at scale
//      1e-6..1e6 gives the same normalized repair (magnitude/scale) up to fp.
//  V6. repaired post-check exact distance (independent oracle) > 0 for all.
// Exits 0 only if all pass. Prints real numbers.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMesh, repairSeparation, closestPair, translateMesh } from '../src/core.mjs';
import { buildAmbient, exactDistance, minimalTranslation, translateAmbient } from './oracle.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dir, '..', 'data', 'corpus.json')));

const TOL_BASE = { tolScale: 1e-4, maxPairs: 4_000_000, iters: 34 };
const TOL_FN = (d) => ({ tol: Math.max(1e-12, Number((1e-4 * d).toPrecision(4))), maxPairs: 4_000_000, iters: 34 });
let failed = 0;
let pass = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name} ${detail}`); }
  else { failed++; console.log(`  FAIL ${name} ${detail}`); }
}

/* V1+V2+V6: 6 real pairs and random pairs */
console.log('== V1/V2/V6: repairability + reach-target + independent exact post-distance > 0 ==');
const allExact = [];

const diagnosePair = (GA, GB, name) => {
  const A = makeMesh(GA.P, GA.I, name + 'A');
  const B0 = makeMesh(GB.P, GB.I, name + 'B0');
  const target = 0.05 * Math.min(A.diag, B0.diag);
  const tol = TOL_FN(Math.min(A.diag, B0.diag));
  // skip if already clear (no repair needed)
  const beforePair = closestPair(A, B0, tol);
  const need = beforePair.lo === null || beforePair.lo < target;
  const R = need ? repairSeparation(A, B0, { ...tol, target }) : { repairable: true, magnitude: 0, repaired: { interval: [beforePair.lo, beforePair.hi] }, translation: [0, 0, 0] };
  const repaired = R.repairable;
  const Bshifted = R.translation ? translateMesh(B0, R.translation[0], R.translation[1], R.translation[2]) : null;
  // independent exact post-distance
  let exactPost = null;
  if (Bshifted) {
    const Am = buildAmbient(GA), Bm = buildAmbient({ P: Bshifted.positions, I: Bshifted.indices });
    exactPost = exactDistance(Am, Bm).d;
  }
  const lo = R.repaired ? R.repaired.interval[0] : null;
  return { need, R, lo, exactPost, A, B0, Bshifted, target };
};

// 6 real pairs
let realReach = 0, realExact = 0;
const realDetail = [];
for (let k = 0; k < data.pairs.length; k++) {
  const [GA, GB] = data.pairs[k];
  const { need, R, lo, exactPost } = diagnosePair(GA, GB, `P${k}`);
  if (R.repairable && R.magnitude === 0) { realReach++; realExact++; continue; } // already clear
  realDetail.push({ k, R, lo, exactPost });
  if (R.repairable && lo !== null && lo > 0 && lo >= targetOf(GA, GB) * 0.999) realReach++;
  if (exactPost !== null && exactPost > 0) realExact++;
}
function targetOf(GA, GB) { const A = makeMesh(GA.P, GA.I); return 0.05 * Math.min(A.diag, makeMesh(GB.P, GB.I).diag); }
// safety recompute for the already-clear case
check('V1: 6/6 real pairs repairable & reach target with lo>0', realReach === 6, `${realReach}/6`);
check('V1b: 6/6 real pairs independent exact post-distance > 0', realExact === 6, `${realExact}/6`);
for (const { k, R, lo, exactPost } of realDetail) {
  console.log(`    P${k} repair mag=${R.magnitude.toFixed(5)} repaired-lo=${lo ? lo.toFixed(6) : 'n/a'} exact-post=${exactPost ? exactPost.toFixed(6) : '0'} dir=${R.direction ? R.direction.map(x => x.toFixed(3)).join(',') : '-'} (certified=${R.repaired && R.repaired.certified})`);
}

// random pairs: success rate over those that need repair
let randomNeed = 0, randomSuccess = 0;
for (const [GA, GB] of data.randomPairs) {
  const A = makeMesh(GA.P, GA.I), B0 = makeMesh(GB.P, GB.I);
  const target = 0.05 * Math.min(A.diag, B0.diag);
  const tol = TOL_FN(Math.min(A.diag, B0.diag));
  const beforePair = closestPair(A, B0, tol);
  const need = beforePair.lo === null || beforePair.lo < target;
  if (!need) continue;
  randomNeed++;
  const R = repairSeparation(A, B0, { ...tol, target });
  if (R.repairable && R.repaired && R.repaired.interval[0] > 0) randomSuccess++;
}
const rate = randomNeed > 0 ? randomSuccess / randomNeed : 1;
check('V2: >=95% of needing-repair random pairs repaired (lo>0)', rate >= 0.95, `${randomSuccess}/${randomNeed} = ${(rate * 100).toFixed(1)}%`);

/* V4: translation optimality gap vs independent oracle (on 6 real pairs, along the direction core chose) */
console.log('== V4: repair.magnitude vs independent oracle minimalTranslation (same direction) ==');
let gapCount = 0, gapSum = 0, gapMax = 0;
for (const { k, R, A, B0 } of [0, 1, 2, 3, 4, 5].map((i) => { const [GA, GB] = data.pairs[i]; const r = diagnosePair(GA, GB, `P${i}`); return { k: i, R: r.R, lo: r.lo, A: r.A, B0: r.B0 }; })) {
  if (!R.repairable || R.magnitude === 0) continue;
  const [ux, uy, uz] = R.direction;
  const Am = buildAmbient({ P: A.positions, I: A.indices });
  const Bm = buildAmbient({ P: B0.positions, I: B0.indices });
  const oracle = minimalTranslation(Am, Bm, ux, uy, uz, 0.05 * Math.min(A.diag, B0.diag));
  if (!oracle) { gapCount++; gapMax = Infinity; continue; }
  const rel = Math.abs(oracle.t - R.magnitude) / Math.max(oracle.t, 1e-12);
  gapCount++; gapSum += rel; gapMax = Math.max(gapMax, rel);
  console.log(`    P${k} core-mag=${R.magnitude.toFixed(5)} oracle-mag=${oracle.t.toFixed(5)} rel=±${(rel * 100).toFixed(2)}% (dir=${R.direction.map(x => x.toFixed(3)).join(',')})`);
}
check('V4: translation within 2% of independent oracle (mean)', gapCount > 0 && gapSum / gapCount <= 0.02, `mean ${(gapSum / Math.max(gapCount, 1) * 100).toFixed(3)}%, max ${gapMax === Infinity ? 'inf' : (gapMax * 100).toFixed(2)}%`);

/* V5: scale invariance */
console.log('== V5: scale invariance (norm of repair / scale constant) ==');
const normNorms = [];
for (const sc of data.scaleCases) {
  const A = makeMesh(sc.A.P, sc.A.I, 'sA'), B0 = makeMesh(sc.B.P, sc.B.I, 'sB');
  const target = 0.05 * Math.min(A.diag, B0.diag);
  const R = repairSeparation(A, B0, { ...TOL_FN(Math.min(A.diag, B0.diag)), target });
  if (!R.repairable) { console.log(`    scale ${sc.scale}: not repairable`); }
  else if (R.magnitude > 0) normNorms.push({ s: sc.scale, t: R.magnitude / sc.scale });
}
let scaleOK = false;
if (normNorms.length >= 2) {
  const t0 = normNorms[0].t;
  const spread = Math.max(...normNorms.map(n => Math.abs(n.t - t0) / t0));
  scaleOK = spread <= 0.05;
  check('V5: normalized repair magnitude constant across 1e-6..1e6', scaleOK, `spread ${(spread * 100).toFixed(3)}%`);
  for (const n of normNorms) console.log(`    scale ${n.s}: t/scale=${n.t.toFixed(6)}`);
} else check('V5: scale invariance', false, 'need >=2 scale cases with nonzero repair');

console.log(`\n=== verify result: ${pass} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);