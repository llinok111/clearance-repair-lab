// Naive planner: exact O(nA*nB) triangle-pair distance, one step along the exact witness
// direction, then one exact verification pass. No BVH, no interval, no direction search.
// This is the baseline the certified planner is compared against.
import { triTriDistance2, translateMesh } from '../src/core.mjs';

export function exactWitness(A, B) {
  let best = Infinity, ia = 0, ib = 0, pa = null, pb = null, tests = 0;
  for (let i = 0; i < A.triCount; i++) {
    for (let j = 0; j < B.triCount; j++) {
      const r = triTriDistance2(A, i, B, j, true);
      tests++;
      if (r.d2 < best) { best = r.d2; ia = i; ib = j; pa = r.pa; pb = r.pb; }
    }
  }
  return { d: Math.sqrt(best), ia, ib, pa, pb, tests };
}

export function naiveRepair(A, B, target) {
  const w = exactWitness(A, B);
  if (!(w.d > 0)) {
    return { verdict: 'no-direction', reason: 'zero-distance-witness', d0: w.d, moved: 0,
      verified: false, translation: [0, 0, 0], tests: w.tests };
  }
  const u = [w.pb[0] - w.pa[0], w.pb[1] - w.pa[1], w.pb[2] - w.pa[2]].map((v) => v / w.d);
  const delta = target - w.d;                      // opens the witness pair to exactly target
  const t = u.map((v) => v * delta);
  const moved = translateMesh(B, t);
  const after = exactWitness(A, moved);
  return { verdict: after.d >= target ? 'repaired' : 'not-separated', d0: w.d, translation: t,
    moved: delta, after: after.d, verified: after.d >= target, tests: w.tests + after.tests };
}
